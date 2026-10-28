import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FindingDocument } from './FindingDocument';
import { groupFindings } from '../findingGroups';
import type { Finding } from '../types';
const make = (id: string, recommendation: string): Finding => ({ id, projectId:'p',sessionId:null,source:'static',severity:'high',status:'new',title:'Race condition in request handling',description:'Two requests read before either writes, allowing duplicate inserts.',category:'technical',filePath:`${id}.ts`,lineNumber:5,artifactId:id,evidenceText:'await insert();',recommendation,confidence:'high',fromRemarks:false,createdAt:'2026-10-22',location:{issueType:'race_condition',domain:'technical',logicFlow:['Request A reads an absent payment.','Request B reads the same absent payment.','Both insert a record.']}});
describe('continuous finding document', () => {
  it('shows every flag and flow continuously with a shared recommendation when remedies match', () => {
    const group=groupFindings([make('a','Enforce atomic uniqueness.'),make('b','Enforce atomic uniqueness.')])[0];
    render(<FindingDocument group={group} selectedId="a" onSelect={vi.fn()} onBack={vi.fn()} actions={()=>null} />);
    expect(screen.getByRole('heading',{name:'Race Condition Risk'})).toBeInTheDocument();
    expect(screen.getAllByRole('region',{name:/Flagged item/})).toHaveLength(2);
    expect(screen.getAllByRole('list',{name:'Logic flow'})).toHaveLength(2);
    expect(screen.getAllByText('Enforce atomic uniqueness.')).toHaveLength(1);
    expect(screen.getByRole('region',{name:'Overall recommendation'})).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('retains individual recommendations when affected flows need different fixes', () => {
    const group=groupFindings([make('a','Use an atomic claim.'),make('b','Deduplicate the callback key.')])[0];
    render(<FindingDocument group={group} selectedId="a" onSelect={vi.fn()} onBack={vi.fn()} actions={()=>null} />);
    expect(screen.queryByRole('region',{name:'Overall recommendation'})).not.toBeInTheDocument();
    expect(within(screen.getByRole('region',{name:'Flagged item 1'})).getByText('Use an atomic claim.')).toBeInTheDocument();
    expect(within(screen.getByRole('region',{name:'Flagged item 2'})).getByText('Deduplicate the callback key.')).toBeInTheDocument();
  });
});
