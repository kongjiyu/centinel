import {BrowserPolicyBlocked} from './actionPolicy.js';
/** Reservations precede dispatch. Lost acknowledgement never refunds a click.
 * Query changes and different locator aliases do not create new permissions. */
export class ActionLedger {
 private readonly clicked=new Set<string>();
 reserveClick(targetKey:string,repeatable:boolean){
  if(this.clicked.has(targetKey)&&!repeatable)throw new BrowserPolicyBlocked('This potentially mutating control was already activated in this Run. Repetition is not approved; check the outcome and test data before retrying.');
  this.clicked.add(targetKey);
 }
}
