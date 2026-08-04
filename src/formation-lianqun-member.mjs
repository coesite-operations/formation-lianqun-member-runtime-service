import { createHash } from "node:crypto";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordAcademySemanticContent } from "./semantic-records.mjs";
import { runMember } from "./a2a-mape-member.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const ACADEMY = "urn:ame:union-officer-academy";
const RUNTIME_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ACADEMY_ROOT = resolve(RUNTIME_ROOT, "../../../..");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`;
const contentId = (value) => identifyJsonSemanticContent({ objectKind: "union-officer-academy.formation-lianqun-member.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
const response = (member, type, source, object) => ({ "@context": CONTEXT, id: contentId({ actor: member.actor, type, inReplyTo: source?.id ?? null, object }), type, actor: member.actor, target: source?.actor ?? ACADEMY, inReplyTo: source?.id ?? "urn:activity:unidentified", object });
const fileDigest = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
function unsupportedPath(value, path = "record") {
  if (value === undefined) return path;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) { const found = unsupportedPath(item, `${path}[${index}]`); if (found) return found; }
  } else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) { const found = unsupportedPath(item, `${path}.${key}`); if (found) return found; }
  }
  return null;
}
async function append(root, member, category, record, recordedAt) {
  const binding = JSON.parse(readFileSync(join(root, "content", "evm", "accounts", "eip155-31337.json"), "utf8"));
  if (binding?.enterprise?.nodeId !== member.id || typeof binding?.account?.caip10 !== "string") throw new Error("member WitnessJournal write requires its exact EVM settlement binding");
  const unsupported = unsupportedPath(record);
  if (unsupported) throw new Error(`${category}: canonical RMN record contains unsupported value at ${unsupported}`);
  // Each member has its own settlement account (checked above), but the
  // formation lianqun's shared categories (market-events, commitments,
  // value-events, the Academy's own formation-lianqun-agreement) must land
  // in one disk-backed store the Academy's own verifiers can read back, the
  // same way one shared R2 bucket did before ruling (b) took the live network
  // and EVM legs off the table for tonight. So this targets the Academy's own
  // disk root, not this member's own directory.
  await recordAcademySemanticContent(ACADEMY_ROOT, category, record, recordedAt);
}
export function serviceConfiguration(root) {
  const carriers = [
    "package.json", "content/member.json", "lib/ownership.json", "lib/service.json",
    "content/contracts/academy-platform-import.json", "content/offices/operator.json", ".well-known/agent-card.json", "src/run.mjs",
  ].map((path) => ({ path, digest: fileDigest(join(root, path)) }));
  const imported = ["src/formation-lianqun-member.mjs", "src/a2a-mape-member.mjs"].map((path) => ({ path, digest: fileDigest(join(RUNTIME_ROOT, path)) }));
  return { carriers, imported, digest: digest({ carriers, imported }) };
}

export async function runFormationLianqunMember({ root, activity, operation, at }) {
  root = resolve(root);
  const member = JSON.parse(readFileSync(join(root, "content/member.json"), "utf8"));
  if (operation === "a2a-message") {
    const result = runMember(member.id, activity);
    await append(root, member, "a2a-tasks", { type: "A2ATaskExchange", request: activity, response: result, performedAt: at }, at);
    return result;
  }
  if (operation === "solicit-service") {
    if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== member.actor || activity.object?.type !== "ServiceSolicitation") return response(member, "Reject", activity, { type: "Refusal", code: "E_SOLICITATION", reason: "exact ActivityStreams Offer<ServiceSolicitation> required" });
    const lot = activity.object.lot;
    if (lot?.type !== "FormationWorkLot" || lot.userOutcome !== member.userOutcome || !lot.requiredCapabilityIds?.some((id) => member.capabilityIds.includes(id))) return response(member, "Reject", activity, { type: "Refusal", code: "E_COMPATIBILITY", reason: "work lot does not advance this member's exact user outcome and capability" });
    const configuration = serviceConfiguration(root);
    const body = { type: "ExecutableFormationBid", contract: "academy-formation-lianqun", lotDigest: digest(lot), provider: member.id, capabilityIds: member.capabilityIds, contributionUnits: member.contributionUnits, conditions: member.conditions, serviceConfigurationDigest: configuration.digest, serviceConfiguration: configuration, threeRights: ["decision", "personnel", "distribution"], approvalFromAbove: false, userOutcome: member.userOutcome, operation: "invoke-service" };
    const offer = response(member, "Offer", activity, body);
    await append(root, member, "market-events", { type: "FormationProviderBid", id: offer.id, provider: member.id, lotDigest: body.lotDigest, contributionUnits: body.contributionUnits, capabilityIds: body.capabilityIds, offeredAt: at, authoredByProvider: true }, at);
    return offer;
  }
  if (operation === "invoke-service") {
    const contract = activity?.object, offer = contract?.offer;
    if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== member.actor || contract?.type !== "ServiceContract" || offer?.actor !== member.actor || offer.object?.type !== "ExecutableFormationBid") return response(member, "Reject", activity, { type: "Refusal", code: "E_CONTRACT", reason: "exact provider-authored bid acceptance required" });
    const capability = contract.capability;
    if (capability?.holder !== member.actor || capability?.invocationTarget !== member.actor || capability?.parentOffer !== offer.id || capability?.capTP?.method !== "invoke-service") return response(member, "Reject", activity, { type: "Refusal", code: "E_CAPABILITY", reason: "attenuated invocation capability is absent or changed" });
    const currentConfiguration = serviceConfiguration(root);
    if (offer.object.serviceConfigurationDigest !== currentConfiguration.digest) return response(member, "Reject", activity, { type: "Refusal", code: "E_PROVIDER_DRIFT", reason: "provider service carriers changed after bid" });
    const commitment = { type: "LianqunMemberCommitment", id: contentId({ provider: member.id, contract: activity.id, lotDigest: offer.object.lotDigest, serviceConfigurationDigest: currentConfiguration.digest }), provider: member.id, contract: activity.id, lotDigest: offer.object.lotDigest, capabilityIds: member.capabilityIds, contributionUnits: member.contributionUnits, serviceConfigurationDigest: currentConfiguration.digest, shareBasis: "measured contribution units subject to receiver outcome and shortfall", mutualSelection: { providerAcceptedLot: true, academyAcceptedProviderBid: true }, threeRightsExercised: ["decision", "personnel", "distribution"], customerOutcomeRequired: true, committedAt: at };
    await append(root, member, "commitments", commitment, at);
    return response(member, "Accept", activity, commitment);
  }
  if (operation === "record-outcome") {
    const receipt = activity?.object;
    if (activity?.["@context"] !== CONTEXT || activity.type !== "Create" || activity.actor !== ACADEMY || activity.target !== member.actor || receipt?.type !== "ReceiverOutcomeReceipt" || receipt.userOutcome !== member.userOutcome) return response(member, "Reject", activity, { type: "Refusal", code: "E_RECEIPT", reason: "receiver-owned outcome receipt required" });
    const value = { type: "WinWinValueAddedEntry", id: contentId({ provider: member.id, receipt: receipt.id }), provider: member.id, receiverReceipt: receipt.id, outcome: receipt.disposition, valueCreated: receipt.disposition === "accepted" ? { measure: "receiver-accepted-formed-officer-and-capstone", quantity: 1 } : { measure: "receiver-accepted-formed-officer-and-capstone", quantity: 0 }, valueCaptured: { monetary: "unsettled", contributionShare: receipt.shares?.[member.id] ?? "unsettled" }, shortfallShared: receipt.disposition !== "accepted", recordedAt: at };
    await append(root, member, "value-events", value, at);
    return response(member, "Accept", activity, value);
  }
  return response(member, "Reject", activity, { type: "Refusal", code: "E_OPERATION", reason: `unknown operation ${operation}` });
}
