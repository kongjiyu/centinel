import { posix as posixPath } from 'node:path';
import ts from 'typescript';
import type { Artifact } from '../artifacts.js';

export type SelectedModule = { artifact: Artifact; source: ts.SourceFile };
export type SelectedExportResolution =
  | { status: 'resolved'; module: SelectedModule; localName: string }
  | { status: 'type_only' }
  | { status: 'unresolved'; reason: string };
export type SelectedExportNames = { names: string[]; unresolved: string[] };

const MAX_SELECTED_MODULE_GRAPH_WORK = 20_000;
const MAX_SELECTED_MODULE_GRAPH_DEPTH = 128;
const GRAPH_LIMIT_REASON = 'The selected module export graph exceeded the bounded resolution work or depth limit; remaining names stay unresolved.';

type ImportBinding = { moduleSpecifier: string; importedName: string; typeOnly: boolean };
type DirectExport =
  | { kind: 'local'; localName: string; typeOnly: boolean }
  | { kind: 'reexport'; moduleSpecifier: string; importedName: string; typeOnly: boolean }
  | { kind: 'unresolved'; reason: string };
type ModuleBindings = {
  declarations: Map<string, ts.Declaration | ts.ImportDeclaration>;
  imports: Map<string, ImportBinding>;
  typeDeclarations: Set<string>;
  directExports: Map<string, DirectExport[]>;
  stars: Array<{ moduleSpecifier: string; typeOnly: boolean }>;
};

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];
export const DEFAULT_EXPORT_EXPRESSION = '<selected-default-export-expression>';
const declarationFile = (module: SelectedModule) => module.source.isDeclarationFile || module.artifact.fileName.toLowerCase().endsWith('.d.ts');
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(node)
  && !!ts.getModifiers(node)?.some(modifier => modifier.kind === kind);
const staticModuleSpecifier = (node: ts.Expression | undefined) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

function normalizedPath(value: string): string {
  const normalized = posixPath.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  return normalized === '.' ? '' : normalized;
}

function addBinding(exports: Map<string, DirectExport[]>, name: string, binding: DirectExport) {
  const list = exports.get(name) ?? [];
  list.push(binding);
  exports.set(name, list);
}

function indexModule(module: SelectedModule): ModuleBindings {
  const declarations = new Map<string, ts.Declaration | ts.ImportDeclaration>();
  const imports = new Map<string, ImportBinding>();
  const typeDeclarations = new Set<string>();
  const directExports = new Map<string, DirectExport[]>();
  const stars: ModuleBindings['stars'] = [];

  for (const statement of module.source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      typeDeclarations.add(statement.name.text);
      // Type declarations may merge with a runtime declaration (for example a
      // function and interface with the same name). Keep the value binding for
      // selected-source execution resolution.
      if (!declarations.has(statement.name.text)) declarations.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    }
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const moduleSpecifier = staticModuleSpecifier(statement.moduleSpecifier);
      if (!moduleSpecifier) continue;
      const clause = statement.importClause;
      const declarationTypeOnly = clause.isTypeOnly;
      if (clause.name) {
        declarations.set(clause.name.text, statement);
        imports.set(clause.name.text, { moduleSpecifier, importedName: 'default', typeOnly: declarationTypeOnly });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        declarations.set(bindings.name.text, statement);
        imports.set(bindings.name.text, { moduleSpecifier, importedName: '*', typeOnly: declarationTypeOnly });
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          declarations.set(specifier.name.text, specifier);
          imports.set(specifier.name.text, {
            moduleSpecifier,
            importedName: (specifier.propertyName ?? specifier.name).text,
            typeOnly: declarationTypeOnly || specifier.isTypeOnly,
          });
        }
      }
    }
  }

  if (declarationFile(module)) {
    for (const statement of module.source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
        addBinding(directExports, hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name.text,
          { kind: 'local', localName: statement.name.text, typeOnly: true });
      } else if (ts.isClassDeclaration(statement) && statement.name && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
        addBinding(directExports, hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name.text,
          { kind: 'local', localName: statement.name.text, typeOnly: true });
      } else if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) {
          addBinding(directExports, declaration.name.text, { kind: 'local', localName: declaration.name.text, typeOnly: true });
        }
      } else if (ts.isExportDeclaration(statement)) {
        const moduleSpecifier = staticModuleSpecifier(statement.moduleSpecifier);
        if (!statement.exportClause) {
          if (moduleSpecifier) stars.push({ moduleSpecifier, typeOnly: statement.isTypeOnly });
          continue;
        }
        if (ts.isNamedExports(statement.exportClause)) for (const specifier of statement.exportClause.elements) {
          addBinding(directExports, specifier.name.text, { kind: 'local', localName: (specifier.propertyName ?? specifier.name).text, typeOnly: true });
        }
      }
    }
    return { declarations, imports, typeDeclarations, directExports, stars };
  }

  for (const statement of module.source.statements) {
    if (ts.isFunctionDeclaration(statement)
      && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      const name = isDefault ? 'default' : statement.name?.text;
      if (name) {
        const localName = statement.name?.text ?? DEFAULT_EXPORT_EXPRESSION;
        declarations.set(localName, statement);
        addBinding(directExports, name, { kind: 'local', localName,
          typeOnly: hasModifier(statement, ts.SyntaxKind.DeclareKeyword) || !statement.body });
      }
    } else if (ts.isClassDeclaration(statement)
      && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      const name = isDefault ? 'default' : statement.name?.text;
      if (name) {
        const localName = statement.name?.text ?? DEFAULT_EXPORT_EXPRESSION;
        declarations.set(localName, statement);
        addBinding(directExports, name, { kind: 'local', localName, typeOnly: hasModifier(statement, ts.SyntaxKind.DeclareKeyword) });
      }
    } else if (ts.isVariableStatement(statement) && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addBinding(directExports, declaration.name.text, {
          kind: 'local', localName: declaration.name.text,
          typeOnly: hasModifier(statement, ts.SyntaxKind.DeclareKeyword) || !declaration.initializer,
        });
        else addBinding(directExports, '<computed export>', { kind: 'unresolved', reason: 'A destructured export name cannot be resolved from its frozen source declaration.' });
      }
    } else if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals && ts.isIdentifier(statement.expression)) {
        addBinding(directExports, 'default', { kind: 'local', localName: statement.expression.text, typeOnly: false });
      } else if (ts.isIdentifier(statement.expression)) {
        addBinding(directExports, 'default', { kind: 'local', localName: statement.expression.text, typeOnly: false });
      } else {
        addBinding(directExports, 'default', { kind: 'local', localName: DEFAULT_EXPORT_EXPRESSION, typeOnly: false });
      }
    } else if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = staticModuleSpecifier(statement.moduleSpecifier);
      if (!statement.exportClause) {
        if (moduleSpecifier) stars.push({ moduleSpecifier, typeOnly: statement.isTypeOnly });
        else addBinding(directExports, '<unknown export surface>', { kind: 'unresolved', reason: 'A module export surface cannot be enumerated from this frozen source.' });
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const typeOnly = statement.isTypeOnly || specifier.isTypeOnly;
          if (typeOnly) {
            addBinding(directExports, specifier.name.text, { kind: 'local', localName: (specifier.propertyName ?? specifier.name).text, typeOnly: true });
          } else if (moduleSpecifier) {
            addBinding(directExports, specifier.name.text, { kind: 'reexport', moduleSpecifier, importedName: (specifier.propertyName ?? specifier.name).text, typeOnly: false });
          } else {
            addBinding(directExports, specifier.name.text, { kind: 'local', localName: (specifier.propertyName ?? specifier.name).text, typeOnly: false });
          }
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        addBinding(directExports, statement.exportClause.name.text, { kind: 'unresolved', reason: 'A namespace export surface cannot be mapped to a single selected-source operation.' });
      }
    }
  }

  return { declarations, imports, typeDeclarations, directExports, stars };
}

/** Resolve only statically named relative imports against the already frozen source set. */
export class SelectedModuleResolver {
  private readonly modulesByPath = new Map<string, SelectedModule[]>();
  private readonly bindings = new Map<SelectedModule, ModuleBindings>();
  private graphWorkCount = 0;
  private graphWorkTruncated = false;

  constructor(modules: SelectedModule[]) {
    for (const module of modules) {
      this.bindings.set(module, indexModule(module));
      for (const value of [module.artifact.filePath, module.artifact.originalPath]) {
        if (!value) continue;
        const key = normalizedPath(value);
        const matches = this.modulesByPath.get(key) ?? [];
        if (!matches.includes(module)) matches.push(module);
        this.modulesByPath.set(key, matches);
      }
    }
  }

  declarations(module: SelectedModule) { return this.bindings.get(module)?.declarations ?? new Map(); }
  imports(module: SelectedModule) { return this.bindings.get(module)?.imports ?? new Map(); }
  isTypeDeclaration(module: SelectedModule, name: string) { return this.bindings.get(module)?.typeDeclarations.has(name) ?? false; }
  isDeclarationFile(module: SelectedModule) { return declarationFile(module); }
  get graphWork() { return { count: this.graphWorkCount, limit: MAX_SELECTED_MODULE_GRAPH_WORK, truncated: this.graphWorkTruncated }; }

  private enterGraphNode(depth: number): boolean {
    if (this.graphWorkTruncated) return false;
    if (depth > MAX_SELECTED_MODULE_GRAPH_DEPTH || this.graphWorkCount >= MAX_SELECTED_MODULE_GRAPH_WORK) {
      this.graphWorkTruncated = true;
      return false;
    }
    this.graphWorkCount++;
    return true;
  }

  resolveModule(from: SelectedModule, specifier: string): { module?: SelectedModule; reason?: string } {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return { reason: 'The import is not a relative path within the selected frozen source set.' };
    }
    const base = normalizedPath(posixPath.join(posixPath.dirname(normalizedPath(from.artifact.filePath)), specifier));
    const rawExtension = posixPath.extname(base).toLowerCase();
    const candidates = rawExtension
      ? [base, ...((rawExtension === '.js' || rawExtension === '.mjs' || rawExtension === '.cjs')
        ? [base.slice(0, -rawExtension.length) + (rawExtension === '.mjs' ? '.mts' : rawExtension === '.cjs' ? '.cts' : '.ts'),
          base.slice(0, -rawExtension.length) + (rawExtension === '.mjs' ? '.mts' : rawExtension === '.cjs' ? '.cts' : '.tsx'),
          base.slice(0, -rawExtension.length) + '.d.ts'] : [])]
      : [base, ...extensions.map(ext => `${base}${ext}`), ...extensions.map(ext => `${base}/index${ext}`)];
    const matchesById = new Map<string, SelectedModule>();
    for (const candidate of candidates) {
      const matches = this.modulesByPath.get(normalizedPath(candidate)) ?? [];
      if (matches.length > 1) return { reason: 'The import path matches multiple selected frozen artifacts and is ambiguous.' };
      if (matches.length === 1) matchesById.set(matches[0].artifact.id, matches[0]);
    }
    const allMatches = [...matchesById.values()];
    const runtimeMatches = allMatches.filter(module => !declarationFile(module));
    // A declaration companion describes the runtime implementation; it does
    // not make an otherwise unique selected implementation path ambiguous.
    const preferredMatches = runtimeMatches.length ? runtimeMatches : allMatches;
    if (preferredMatches.length > 1) return { reason: 'The import path matches multiple selected frozen artifacts and is ambiguous.' };
    if (preferredMatches.length === 1) return { module: preferredMatches[0] };
    return { reason: 'The import target is not present in the selected frozen source set.' };
  }

  resolveExport(module: SelectedModule, exportedName: string, visiting = new Set<string>()): SelectedExportResolution {
    if (!this.enterGraphNode(visiting.size)) return { status: 'unresolved', reason: GRAPH_LIMIT_REASON };
    if (declarationFile(module)) return { status: 'type_only' };
    const key = `${module.artifact.id}\u0000${exportedName}`;
    if (visiting.has(key)) return { status: 'unresolved', reason: 'The selected module export graph contains a cycle that cannot be resolved safely.' };
    const next = new Set(visiting).add(key);
    const bindings = this.bindings.get(module);
    if (!bindings) return { status: 'unresolved', reason: 'The selected module is missing from the frozen export index.' };

    const direct = bindings.directExports.get(exportedName) ?? [];
    const unresolvedDirect = direct.find((binding): binding is Extract<DirectExport, { kind: 'unresolved' }> => binding.kind === 'unresolved');
    if (unresolvedDirect) return { status: 'unresolved', reason: unresolvedDirect.reason };
    // Bodyless overload signatures and type-only declarations share the name
    // of their runtime implementation. They do not compete with its binding.
    const runtimeDirect: Array<Exclude<DirectExport, { kind: 'unresolved' }>> = direct.filter(
      (binding): binding is Exclude<DirectExport, { kind: 'unresolved' }> => binding.kind !== 'unresolved'
        && (binding.kind !== 'local' || !binding.typeOnly));
    // One bodyful overload implementation remains after its bodyless signature
    // entries are filtered above. Multiple runtime bindings still fail closed.
    if (runtimeDirect.length > 1) return { status: 'unresolved', reason: 'The module defines multiple competing exports with this name.' };
    if (!runtimeDirect.length && direct.length) return { status: 'type_only' };
    if (runtimeDirect.length) {
      const binding = runtimeDirect[0];
      if (!binding) return { status: 'unresolved', reason: 'The module export binding could not be selected safely.' };
      if (binding.kind === 'reexport') {
        const target = this.resolveModule(module, binding.moduleSpecifier);
        if (!target.module) return { status: 'unresolved', reason: target.reason ?? 'The selected module export could not be resolved.' };
        return this.resolveExport(target.module, binding.importedName, next);
      }
      if (!binding.localName) return { status: 'unresolved', reason: 'The default export expression is not attached to a named declaration.' };
      return this.resolveLocal(module, binding.localName, next);
    }

    if (!bindings.stars.length) return { status: 'unresolved', reason: 'The selected module does not export this name.' };
    const results: Array<{ module: SelectedModule; localName: string }> = [];
    let sawTypeOnly = false;
    let unresolvedReason: string | undefined;
    for (const star of bindings.stars) {
      if (star.typeOnly) continue;
      const target = this.resolveModule(module, star.moduleSpecifier);
      if (!target.module) { unresolvedReason = target.reason; continue; }
      const resolved = this.resolveExport(target.module, exportedName, next);
      if (resolved.status === 'resolved') results.push(resolved);
      else if (resolved.status === 'type_only') sawTypeOnly = true;
      else if (!resolved.reason.includes('does not export this name')) unresolvedReason = resolved.reason;
    }
    const unique = [...new Map(results.map(result => [`${result.module.artifact.id}\u0000${result.localName}`, result])).values()];
    if (unique.length > 1) return { status: 'unresolved', reason: 'Multiple selected star exports provide the same name, so the public binding is ambiguous.' };
    if (unique.length === 1 && !unresolvedReason) return { status: 'resolved', ...unique[0] };
    if (unresolvedReason) return { status: 'unresolved', reason: unresolvedReason };
    if (sawTypeOnly) return { status: 'type_only' };
    return { status: 'unresolved', reason: 'No selected star-export target provides this name.' };
  }

  resolveLocal(module: SelectedModule, localName: string, visiting = new Set<string>()): SelectedExportResolution {
    if (!this.enterGraphNode(visiting.size)) return { status: 'unresolved', reason: GRAPH_LIMIT_REASON };
    if (declarationFile(module)) return { status: 'type_only' };
    if (localName === DEFAULT_EXPORT_EXPRESSION) {
      const assignment = module.source.statements.find(ts.isExportAssignment);
      const defaultDeclaration = module.source.statements.find(statement =>
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
        && hasModifier(statement, ts.SyntaxKind.DefaultKeyword));
      const expression = assignment?.expression;
      if (expression && ts.isIdentifier(expression)) return this.resolveLocal(module, expression.text, visiting);
      if (assignment || defaultDeclaration) return { status: 'resolved', module, localName };
      return { status: 'unresolved', reason: 'The selected module has no default export expression.' };
    }
    const binding = this.imports(module).get(localName);
    if (binding) {
      if (binding.typeOnly) return { status: 'type_only' };
      if (binding.importedName === '*') {
        const target = this.resolveModule(module, binding.moduleSpecifier);
        return target.module ? { status: 'resolved', module: target.module, localName: '*' }
          : { status: 'unresolved', reason: target.reason ?? 'The selected namespace import could not be resolved.' };
      }
      const target = this.resolveModule(module, binding.moduleSpecifier);
      if (!target.module) return { status: 'unresolved', reason: target.reason ?? 'The selected import could not be resolved.' };
      return this.resolveExport(target.module, binding.importedName, visiting);
    }
    const declaration = this.declarations(module).get(localName);
    if (!declaration && this.isTypeDeclaration(module, localName)) return { status: 'type_only' };
    if (!declaration) return { status: 'unresolved', reason: 'The selected module has no matching top-level declaration.' };
    if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) || hasModifier(declaration, ts.SyntaxKind.DeclareKeyword)) return { status: 'type_only' };
    if (ts.isFunctionDeclaration(declaration) && !declaration.body) return { status: 'type_only' };
    if (ts.isVariableDeclaration(declaration) && !declaration.initializer) return { status: 'type_only' };
    return { status: 'resolved', module, localName };
  }

  exportedNames(module: SelectedModule, visiting = new Set<string>()): SelectedExportNames {
    if (!this.enterGraphNode(visiting.size)) return { names: [], unresolved: [GRAPH_LIMIT_REASON] };
    const key = module.artifact.id;
    if (visiting.has(key)) return { names: [], unresolved: ['The selected module export graph contains a star-export cycle.'] };
    const next = new Set(visiting).add(key);
    const bindings = this.bindings.get(module);
    if (!bindings) return { names: [], unresolved: ['The selected module is missing from the frozen export index.'] };
    const names = new Set(bindings.directExports.keys());
    const unresolved: string[] = [...bindings.directExports.values()].flat().filter(binding => binding.kind === 'unresolved').map(binding => binding.reason);
    for (const star of bindings.stars) {
      if (star.typeOnly) continue;
      const target = this.resolveModule(module, star.moduleSpecifier);
      if (!target.module) { unresolved.push(target.reason ?? 'The selected star-export target could not be resolved.'); continue; }
      const nested = this.exportedNames(target.module, next);
      for (const name of nested.names) if (name !== 'default' && !names.has(name)) names.add(name);
      unresolved.push(...nested.unresolved);
    }
    for (const name of [...names]) {
      const result = this.resolveExport(module, name);
      if (result.status === 'unresolved') unresolved.push(result.reason);
    }
    return { names: [...names].sort(), unresolved: [...new Set(unresolved)] };
  }
}
