export const TALK_TRACK = [
  {
    heading: "Instructions and Talk Track",
    content: [
      {
        heading: "Solution Overview",
        body: "This platform demonstrates why MongoDB Atlas is a robust choice for healthcare clinical decision support systems (CDS). Organizations using AWS Healthlake (or similar FHIR data stores) for interoperability hit operational limits when trying to use that same store for real-time clinical workflows, high latency, poor nested aggregation queries, no native time-series support, and unpredictable usage-based costs. MongoDB Atlas fills that operational gap.",
      },
      {
        image: {
          src: "/clinical-bullets.png",
          alt: "Detection of patient deterioration, Automated clinical guidance, Care quality as a revenue driver",
        },
      },
      {
        heading: "How to Demo",
        ordered: true,
        body: [
          "From the home screen, select a persona, choose Frida to customize the simulation settings.",
          "Define your simulation settings and click 'Start Demo'. The platform runs a 9 step seeding pipeline generating synthetic patients, vitals histories, care gaps, and clinical alerts automatically.",
          "The Dashboard surfaces patient risk aggregations and HEDIS measure data powered by an Atlas aggregation pipeline, click 'View MongoDB Pipeline' to expose the query in real time.",
          "The patient list is prioritized by risk score, factoring in clinical conditions, real-time vitals, medications, and open care gaps. The first patient carries the highest priority.",
          "Click a patient to open the Patient Detail view. The Primary Concern card surfaces the most clinically significant condition, click it to retrieve the CDS Hook card with actionable recommendations.",
          "Clinical Pressure shows vital signs breaching personalized thresholds. Escalation Drivers synthesize those signals with active alerts and open care gaps into a single priority ranking.",
          "The vitals chart streams live data from the wearable patch simulation, watch deteriorating patterns trigger new alerts in real time, powered by MongoDB's native Time Series collection.",
          "Click 'Open Patient Chart' to view open Care Gaps and start an intervention workflow. Select a gap (e.g. CDC-HBA) to open the workflow: order labs, record results by choosing a simulated outcome (Controlled, Elevated, Concerning), and generate an automated Clinician Review Summary, all written to the same MongoDB document.",
          "In the Care Gaps tab, population level Atlas Charts give the care coordinator a full picture: Top Firing CDS Rules, Gap Status by HEDIS Measure, HEDIS Compliance Rate by Measure, and more embedded directly in the application.",
        ],
      },
      {
        heading: "Common Questions & Talk Tracks",
        body: [
          "\"Why not just query Healthlake directly?\" — Healthlake is optimized for FHIR exchange and compliance, not sub-millisecond operational queries. MongoDB Atlas sits alongside it as the real-time CDS layer.",
          "\"Is the clinical data accurate?\" — The simulator generates realistic but randomized histories. In production this data comes from the FHIR store via Healthlake.",
          "\"Are the HEDIS rules production-grade?\" — The engine evaluates screening compliance. A production implementation would also evaluate result-based numerator criteria like HbA1c < 8%.",
          "\"Why Python and not CQL?\" — HEDIS rules are Python logic here to focus on the data layer. Production deployments would author measures in CQL.",
        ],
      },
    ],
  },
  {
    heading: "Behind the Scenes",
    content: [
      {
        heading: "Architecture Overview",
        body: "Patient clinical data is inserted into the FHIR data store, while vitals data streams directly into MongoDB. The relevant patient data is then materialized into MongoDB Atlas as a denormalized patient_360 document. MongoDB powers the real-time clinical decision support engine, the care gap intervention workflow, Atlas Charts for population analytics, and queryable encryption for protecting sensitive patient data at rest.",
      },
      {
        image: {
          src: "/architecture-diagram.png",
          alt: "Architecture diagram showing FHIR data store, MongoDB Atlas materialization, and CDS operational layer",
          height: 420,
        },
      },
      {
        heading: "9-Step Seeding Pipeline",
        body: [
          "1. Generate synthetic FHIR R4 patient bundles → synthetic_patients",
          "2. Generate 24h vitals histories per patient → synthetic_vitals (Time Series)",
          "3. Materialize FHIR bundles into denormalized patient_360 documents",
          "4. Seed 5 CDS rule definitions",
          "5. Compute per-patient personalized thresholds (beta-blocker → HR 90, CKD → SpO2 90)",
          "6. Evaluate CDS rules against current vitals → generate clinical alerts",
          "7. Compute HEDIS care gaps (5 measures per patient) → write to patient_360",
          "8. Seed provider-patient attributions",
          "9. Start real-time SSE vitals simulation worker",
        ],
      },
      {
        heading: "CDS Engines",
        body: [
          "AlertEngine: Real-time threshold monitoring with personalized thresholds, sustained-breach detection, 2-hour baseline calculation, and 4-hour trend analysis. Implements 5 clinical rules including beta-blocker-aware tachycardia, multi-factor hypoglycemia, CKD metabolic acidosis, and sepsis warning.",
          "QualityEngine: HEDIS care gap computation for 5 measures targeting the T2DM + CKD cohort: CDC-HBA, KED, CBP, SPD, and EED. Outputs structured evidence, recommended actions, and priority escalation.",
        ],
      },
      {
        heading: "Tech Stack",
        body: [
          "Backend: Python / FastAPI — Route → Service → Repository pattern",
          "Frontend: Next.js with TypeScript",
          "Database: MongoDB Atlas (document store + Time Series collections)",
          "Real-time: Server-Sent Events (SSE) for live vitals streaming",
        ],
      },
    ],
  },
  {
    heading: "Why MongoDB?",
    content: [
      {
        image: {
          src: "/mongodb-elements.png",
          alt: "MongoDB Atlas capabilities used in this platform",
        },
      },
      {
        heading: "Flexible Document Model",
        body: "The patient_360 document collapses what would be dozens of normalized FHIR resource lookups into a single sub-millisecond read. Demographics, conditions, medications, labs, vitals summary, care gaps, alerts, personalized thresholds, and intervention workflows all coexist in one document with no joins required.",
      },
      {
        heading: "Native Time Series Collections",
        body: "synthetic_vitals is a MongoDB Time Series collection purpose-built for wearable patch telemetry. Automatic bucketing, compressed storage, and range queries over timestamp + patient_id enable efficient trend analysis and deterioration detection that would be impractical in a FHIR data lake.",
      },
      {
        heading: "Aggregation Pipeline",
        body: [
          "Dashboard patient list: multi-patient aggregation with alert counts, care gap status, and vitals summaries in one round-trip.",
          "Care gap computation: JavaScript-side HEDIS logic backed by indexed MongoDB queries on conditions, medications, and lab codes.",
          "Vitals trend analysis: time-bucketed aggregations over synthetic_vitals for 2-hour baselines and 4-hour deterioration trends.",
        ],
      },
      {
        heading: "Schema Flexibility at Runtime",
        body: "KED and CDC-HBA intervention workflows have different shapes different order fields, different evidence structures, yet both coexist inside the same patient_360.interventions array. No migrations required as new workflow types are added.",
      },
      {
        heading: "Operational Separation from the FHIR Layer",
        body: "MongoDB Atlas sits alongside AWS Healthlake, not instead of it. FHIR remains the canonical interoperability and exchange format. MongoDB powers the derived, denormalized operational views that care coordinators actually query at the point of care. This dual-layer pattern is exactly how modern health systems scale CDS without compromising FHIR compliance.",
      },
      {
        heading: "Embedded Analytics with Atlas Charts",
        body: "The Care Gaps tab embeds an Atlas Charts dashboard directly inside the application, no separate BI tool, no data export, no ETL pipeline. Population-level metrics like Top Firing CDS Rules, Gap Status by HEDIS Measure, and HEDIS Compliance Rate by Measure are served from the same MongoDB Atlas cluster that powers the operational workload. Because the charts query the live patient_360 collection, they reflect the current state of the data in real time without any synchronization overhead.",
      },
      {
        heading: "Queryable Encryption for PHI Protection",
        body: [
          "Healthcare applications handle Protected Health Information (PHI) governed by HIPAA. Traditional encryption protects data at rest and in transit, but requires decrypting fields before querying and exposing plaintext to the application server and anyone who compromises it.",
          "MongoDB Queryable Encryption allows the platform to run queries directly on encrypted fields without ever decrypting them on the server. The encryption keys never leave the client. Even if the database server or application layer were compromised, patient data remains unreadable.",
          "In this platform, sensitive patient fields are encrypted at rest and remain queryable, demonstrating that clinical decision support workloads do not require a tradeoff between performance and data protection a critical capability for any production healthcare deployment.",
        ],
      },
      {
        heading: "Predictable Cost Model",
        body: [
          "AWS Healthlake pricing is usage-based: every FHIR read, search query, data import, and export operation adds to the bill, alongside per GB storage charges. A CDS workload running continuous alert evaluation, care gap computation, and vitals trend queries against Healthlake generates unpredictable costs that scale directly with clinical activity.",
          "MongoDB Atlas uses tiered infrastructure pricing. Customer pay for the cluster size, not the number of queries. Whether the system processes 10,000 or 10 million clinical decisions in a month, the infrastructure cost stays the same.",
          "For healthcare organizations operating under tight budget cycles and value based care contracts, predictable infrastructure costs are not a nice-to-have, they are a requirement for sustainable operations.",
        ],
      },
    ],
  },
];
