import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { createImmutableContentCustody } from "@red-cup-engineering/immutable-content-custody-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent, sha256DigestFromNiUri } from "@red-cup-engineering/semantic-content-identify-service";
import { seavt } from "@red-cup-engineering/witness-journal-entry-service";
import { appendSeavt, readSeavtAtPath } from "@red-cup-engineering/witness-journal-log-service";

const OBJECT_KIND = "union-officer-academy.record";
const FEED = "academy.semantic-records";
const ROOT = resolve(import.meta.dirname, "..");

function filesBelow(root, suffix = "") {
  const files=[]; function visit(path){let entries;try{entries=readdirSync(path,{withFileTypes:true});}catch(error){if(error?.code==="ENOENT")return;throw error;}for(const entry of entries){const child=join(path,entry.name);if(entry.isDirectory())visit(child);else if(entry.isFile()&&entry.name.endsWith(suffix))files.push(child);}} visit(root); return files.sort();
}
function objectPath(root,key){const path=resolve(root,"objects",...key.split("/")),base=resolve(root,"objects");if(path!==base&&!path.startsWith(`${base}${sep}`))throw new Error("immutable content key escapes Academy custody");return path;}
function custody(root){const dataRoot=join(root,"data","semantic-content");const r2=Object.freeze({async putCurrent(key,{body,mediaType="application/octet-stream"}){const path=objectPath(dataRoot,key),temporary=`${path}.${randomUUID()}.tmp`;mkdirSync(dirname(path),{recursive:true});writeFileSync(temporary,Buffer.from(body));renameSync(temporary,path);writeFileSync(`${path}.media-type`,`${mediaType}\n`);return{conflict:false};},async get(key){const path=objectPath(dataRoot,key);try{return{body:readFileSync(path),mediaType:readFileSync(`${path}.media-type`,"utf8").trim()};}catch(error){if(error?.code==="ENOENT")return null;throw error;}}});return createImmutableContentCustody({r2});}
function identify(value){return identifyJsonSemanticContent({objectKind:OBJECT_KIND,value,witnessRoot:EMPTY_WITNESS_ROOT});}
function tokenSurface(role,token){return `semantic-content.${role}.sha256.${Buffer.from(sha256DigestFromNiUri(token),"base64url").toString("hex")}`;}
function tokenFromSurface(surface){const match=/^semantic-content\.record\.sha256\.([a-f0-9]{64})$/u.exec(surface);if(!match)throw new TypeError("record coordinate is not an Academy semantic content surface");return `ni:///sha-256;${Buffer.from(match[1],"hex").toString("base64url")}`;}
function categorySurface(category){return tokenSurface("category",identify(category).token);}

export async function recordAcademySemanticContent(root,category,record,recordedAt=new Date().toISOString()){
  const addressed=identify(record);await custody(root).put({ni:addressed.token,bytes:addressed.bytes,mediaType:"application/vnd.561-group.semantic-content+rmn"});
  const appended=appendSeavt(root,FEED,[seavt(categorySurface(category),"academy-record:member",tokenSurface("record",addressed.token),recordedAt)],recordedAt);
  return Object.freeze({semanticId:addressed.token,reference:Object.freeze({ni:addressed.token}),appended:appended.appended,record});
}
export async function queryAcademySemanticContent(category,{root=ROOT}={}){
  const entity=categorySurface(category),rows=filesBelow(join(root,"data","logs"),`.jsonl`).flatMap(readSeavtAtPath).filter((row)=>row.e===entity&&row.a==="academy-record:member");
  const content=custody(root),seen=new Set(),records=[];for(const row of rows){const token=tokenFromSurface(row.v);if(seen.has(token))continue;seen.add(token);const retained=await content.get(token);if(!retained)throw new Error(`Academy semantic content ${token} is indexed but absent from custody`);records.push(admitJsonSemanticContent({bytes:retained.bytes,token,objectKind:OBJECT_KIND}).value);}return records;
}
export function academySemanticRecordStore(root=ROOT){return Object.freeze({record:({category,record,recordedAt})=>recordAcademySemanticContent(root,category,record,recordedAt),query:(category)=>queryAcademySemanticContent(category,{root})});}
