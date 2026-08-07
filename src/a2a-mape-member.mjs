import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";


export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
export function contentId(value) { return identifyJsonSemanticContent({ objectKind: "union-officer-academy.formation-mape-member.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).token; }

function stage(loopId, name, actor, predecessors, knowledgeRefs, evidence) {
  const body = { type: "MAPEStage", loopId, stage: name, actor, predecessors, knowledgeRefs, evidence };
  return { id: contentId(body), ...body };
}

function requestData(request) {
  if (request?.jsonrpc !== "2.0" || request.method !== "SendMessage") throw new TypeError("member admits A2A 1.0 JSON-RPC SendMessage");
  const message = request.params?.message;
  if (message?.role !== "ROLE_USER" || !Array.isArray(message.parts)) throw new TypeError("A2A request requires a ROLE_USER Message with parts");
  const value = message.parts.find((part) => part?.mediaType === "application/json" && part?.data)?.data;
  if (value?.type !== "FormationMapeStageRequest") throw new TypeError("A2A message carries no FormationMapeStageRequest data part");
  return value;
}

function complete(request, actor, artifact) {
  const taskBody = {
    contextId: requestData(request).loopId,
    status: { state: "TASK_STATE_COMPLETED" },
    artifacts: [{ artifactId: contentId(artifact), name: artifact.type, parts: [{ data: artifact, mediaType: "application/json" }] }]
  };
  const task = { id: contentId(taskBody), ...taskBody };
  return { jsonrpc: "2.0", id: request.id, result: { task }, _meta: { protocol: "A2A", protocolVersion: "1.0", binding: "urn:emsenn:binding:a2a-stdio-jsonrpc-v1", actor } };
}

function monitor(value, actor) {
  return stage(value.loopId, "monitor", actor, [], value.knowledgeRefs, {
    requestDigest: value.requestDigest,
    roots: value.observation.roots,
    corpusDigest: value.observation.corpusDigest,
    nodeCount: value.observation.nodes.length,
    officeCount: value.observation.offices.length,
    academyOperationalChecks: value.observation.academyOperationalChecks,
    nodes: value.observation.nodes,
    offices: value.observation.offices,
    ...(value.observation.formationDemand ? { formationDemand: value.observation.formationDemand } : {}),
    epistemicStatus: "bounded-observation",
    uncertainty: value.observation.uncertainty,
    customerTerritoryMutation: false
  });
}

function analyze(value, actor) {
  const observed = value.predecessor.evidence;
  const findings = [];
  for (const check of observed.academyOperationalChecks ?? []) if (!check.settled) findings.push({
    type: "academy-operational-gap", severity: "blocking", criterion: check.id, evidence: check.evidence, explanation: check.explanation
  });
  if (value.scope === "union-readiness") {
    const covered = new Set(value.coveredOfficeIds ?? []);
    const academyOwners = new Set(["union-officer-academy", "context-compilation-xiaowei", "independent-examination-xiaowei", "formation-market-xiaowei", "situated-practice-xiaowei", "qualification-registry-xiaowei"]);
    for (const office of observed.offices ?? []) if (!covered.has(office.id) && !academyOwners.has(office.owner)) {
      if (office.owner === "unowned") findings.push({
        type: "office-ownership-coordination-required", severity: "coordination-required", office: office.id, owner: null, evidence: office.digest,
        explanation: "the office has no resolvable sovereign provider membrane; ownership must settle before an executable formation demand can be addressed"
      });
      else if (office.ownerAdvertised !== true) findings.push({
        type: "office-provider-advertisement-required", severity: "coordination-required", office: office.id, owner: office.owner,
        ownerPackage: office.ownerPackage, ownerMeshBoundary: office.ownerMeshBoundary, evidence: office.digest,
        explanation: "the office's package settlement membrane is resolved, but its owner does not advertise a provider-owned solicitation and invocation boundary"
      });
      else findings.push({
        type: "office-formation-coverage-gap", severity: "formation-demand", office: office.id, owner: office.owner, evidence: office.digest,
        explanation: "the Union office has no digest-bound Academy curriculum or formation offer"
      });
    }
  }
  return stage(value.loopId, "analyze", actor, [value.predecessor.id], value.knowledgeRefs, {
    diagnosisOf: value.predecessor.id,
    findingCount: findings.length,
    findings,
    evidenceSeparatedFromExplanation: true,
    actionSelected: false
  });
}

function plan(value, actor) {
  const interventions = value.predecessor.evidence.findings.map((finding) => finding.type === "academy-operational-gap" ? {
    type: "AcademyRectificationDemand", target: "urn:ame:union-officer-academy", criterion: finding.criterion,
    proofObligation: `settle ${finding.criterion} under the Academy operational conformance gate`, customerMutation: false
  } : finding.type === "office-ownership-coordination-required" ? {
    type: "CoordinationRequired", target: null, office: finding.office, reason: finding.explanation,
    proofObligation: "resolve the office's sovereign owning settlement before provider discovery", customerMutation: false
  } : finding.type === "office-provider-advertisement-required" ? {
    type: "CoordinationRequired", target: null, office: finding.office, owner: finding.owner, reason: finding.explanation,
    proofObligation: "the owning settlement must advertise and admit its own provider boundary before the Academy may address an executable formation demand", customerMutation: false
  } : {
    type: "OfficeFormationDemand", target: `urn:ame:${finding.owner}`, office: finding.office,
    proofObligation: "compile a digest-bound context bundle, exercise regime, and independent qualification law", customerMutation: false
  });
  return stage(value.loopId, "plan", actor, [value.predecessor.id], value.knowledgeRefs, {
    diagnosis: value.predecessor.id,
    assumptions: ["the supplied roots are the complete authorized observation scope", "receiver offices retain admission and appointment authority"],
    proofObligationsExplicit: true,
    diagnosisRevised: false,
    interventionCount: interventions.length,
    interventions
  });
}

function execute(value, actor) {
  const executable = value.predecessor.evidence.interventions.filter((intervention) => typeof intervention.target === "string");
  const coordinationRequired = value.predecessor.evidence.interventions.filter((intervention) => intervention.type === "CoordinationRequired");
  const offers = executable.map((intervention) => {
    const object = { ...intervention, sourcePlan: value.predecessor.id, authority: { writesCustomer: false, appointsOfficer: false, receiverAdmissionRequired: true } };
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: contentId({ actor, target: intervention.target, object }),
      type: "Offer",
      actor,
      target: intervention.target,
      object
    };
  });
  return stage(value.loopId, "execute", actor, [value.predecessor.id], value.knowledgeRefs, {
    plan: value.predecessor.id,
    emittedOfferCount: offers.length,
    offers,
    deliveryOutcomes: value.deliveryOutcomes ?? [],
    actualBoundaryCrossingCount: (value.deliveryOutcomes ?? []).filter((item) => item.invoked === true).length,
    coordinationRequired,
    privilegedMutation: false,
    customerTerritoryMutation: false
  });
}

function know(value, actor) {
  const body = {
    type: "FormationMapeKnowledgeCommit",
    loopId: value.loopId,
    actor,
    stageIds: value.stages.map((item) => item.id),
    requestDigest: value.requestDigest,
    corpusDigest: value.corpusDigest,
    contradictionsRetained: true,
    customerTerritoryMutation: false
  };
  return { id: contentId(body), ...body };
}

export function runMember(member, request) {
  const value = requestData(request);
  const actor = `urn:ame:${member}`;
  let artifact;
  if (["formation-observation-xiaowei", "context-compilation-xiaowei"].includes(member) && value.stage === "monitor") artifact = monitor(value, actor);
  else if (["formation-diagnosis-xiaowei", "independent-examination-xiaowei"].includes(member) && value.stage === "analyze") artifact = analyze(value, actor);
  else if (["formation-planning-xiaowei", "formation-market-xiaowei"].includes(member) && value.stage === "plan") artifact = plan(value, actor);
  else if (["formation-execution-xiaowei", "situated-practice-xiaowei"].includes(member) && value.stage === "execute") artifact = execute(value, actor);
  else if (["formation-knowledge-xiaowei", "qualification-registry-xiaowei"].includes(member) && value.stage === "knowledge") artifact = know(value, actor);
  else throw new TypeError(`${member} refuses stage ${value.stage}`);
  return complete(request, actor, artifact);
}

export function runMemberCli(member) {
  const request = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(`${JSON.stringify(runMember(member, request), null, 2)}\n`);
}
