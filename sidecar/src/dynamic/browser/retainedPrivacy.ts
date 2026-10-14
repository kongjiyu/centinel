import fs from 'node:fs';
import path from 'node:path';
import {redactObservation,redactObservationRecord} from './privacy.js';
/** Rescrub this Run's bounded text artifacts when DOM discovers a new secret.
 * Do not touch pixels, private session state or another Run's history. */
export function rescrubRunText(directories:readonly string[],secrets:readonly string[]){
 const files=directories.flatMap(directory=>fs.readdirSync(directory).filter(name=>/\.(json|md)$/.test(name)).map(name=>path.join(directory,name)));
 if(files.length>128)throw Error('Retained text privacy limit exceeded');
 for(const file of files){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1000000)throw Error('Retained text privacy boundary unavailable');const text=fs.readFileSync(file,'utf8');const clean=file.endsWith('.json')?JSON.stringify(redactObservationRecord(JSON.parse(text),secrets),null,2):redactObservation(text,secrets);fs.writeFileSync(file,clean);}
}
