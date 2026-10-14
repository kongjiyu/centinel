export const USABILITY_RULES=['labels','keyboard','focus','feedback','error_recovery'] as const;
export type UsabilityRule=typeof USABILITY_RULES[number];
export const PERSONAS={first_time:{name:'First-time visitor',description:'Unfamiliar with the workflow; inspect clear control labels, progress feedback and recoverable errors.'},keyboard_only:{name:'Keyboard-only navigation',description:'Navigate using safe Tab/Shift+Tab without pointer activation; inspect control reachability and observable focus styling.'},returning:{name:'Returning task-focused visitor',description:'Complete the declared task efficiently; inspect predictable controls and feedback.'}} as const;
export type UsabilityConfig={schemaVersion:1;includeSuggestions?:boolean;persona:keyof typeof PERSONAS;rules:UsabilityRule[];feedbackCheckIds:string[];errorRecoveryCheckIds:string[]};
export type UsabilityObservation={ruleId:UsabilityRule;persona:UsabilityConfig['persona'];kind:'deterministic';verdict:'passed'|'failed'|'uncertain'|'not_tested';expected:string;observed:string;controlRef?:string;checkId?:string;evidenceIds:string[]};
export type UsabilityAssessment={schemaVersion:1;config:UsabilityConfig;observations:UsabilityObservation[];limitations:string[];keyboardActions:number;assessedAt:string;suggestions?:UsabilitySuggestions};

export type UsabilitySuggestion={ruleId:UsabilityRule;suggestion:string;rationale:string;observationIndexes:number[];evidenceIds:string[]};
export type UsabilitySuggestions={schemaVersion:1;kind:'subjective';status:'completed'|'unavailable';reason:null|'budget_limit'|'provider_unavailable'|'invalid_response'|'not_executed';model:{provider:string;apiFormat:string;model:string}|null;sampledObservationIndexes:number[];omittedObservationCount:number;items:UsabilitySuggestion[]};
