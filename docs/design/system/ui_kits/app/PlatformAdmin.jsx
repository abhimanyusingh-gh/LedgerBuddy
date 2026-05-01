// PlatformAdmin.jsx — LedgerBuddy Platform Admin (super-admin) console.
// Distinct from tenant workspace: oversees ALL CA-firm tenants on the platform.
// Wired in App.tsx as: PlatformAdminTopNav + PlatformOnboardSection + PlatformAnalyticsDashboard
// + PlatformUsageOverviewSection + PlatformActivityMonitor.

const PA_TENANTS = [
  { id: "t1", name: "Khan & Associates, CA",   plan: "Practice",  seats: 12, seatsUsed: 12, clientOrgs: 8, mrr: 28800,  docs7: 1342, docsToday: 184, failedDocs: 4,  state: "active",   bridge: "online",  region: "Mumbai",     mailFails: 0, signedUp: "12-Sep-2024", lastSeen: "just now",     trial: false, owner: "Mahir Khan",        ownerEmail: "mahir@khan-ca.in" },
  { id: "t2", name: "Jha Subramanian & Co",    plan: "Practice",  seats: 8,  seatsUsed: 7,  clientOrgs: 5, mrr: 19200,  docs7: 612,  docsToday: 81,  failedDocs: 1,  state: "active",   bridge: "online",  region: "Bangalore",  mailFails: 0, signedUp: "03-Jan-2025", lastSeen: "2 min ago",    trial: false, owner: "Aditi Jha",         ownerEmail: "aditi@jhasub.in" },
  { id: "t3", name: "Patel Mehta CA LLP",      plan: "Practice",  seats: 16, seatsUsed: 14, clientOrgs: 12, mrr: 38400, docs7: 2104, docsToday: 312, failedDocs: 9,  state: "active",   bridge: "lagging", region: "Ahmedabad",  mailFails: 1, signedUp: "22-Nov-2024", lastSeen: "11 min ago",   trial: false, owner: "Hetal Mehta",       ownerEmail: "hetal@patelmehta.in" },
  { id: "t4", name: "SRC Tax Advisors",        plan: "Solo",      seats: 3,  seatsUsed: 2,  clientOrgs: 3, mrr: 4800,   docs7: 184,  docsToday: 22,  failedDocs: 0,  state: "active",   bridge: "online",  region: "Pune",       mailFails: 0, signedUp: "08-Feb-2025", lastSeen: "1 h ago",      trial: false, owner: "Sundar Ram Chaudhary", ownerEmail: "sundar@srctax.in" },
  { id: "t5", name: "Coastal Books Pvt Ltd",   plan: "Solo",      seats: 2,  seatsUsed: 2,  clientOrgs: 1, mrr: 0,      docs7: 47,   docsToday: 6,   failedDocs: 0,  state: "trial",    bridge: "offline", region: "Kochi",      mailFails: 0, signedUp: "20-Apr-2026", lastSeen: "3 h ago",      trial: true,  owner: "Anand Pillai",      ownerEmail: "anand@coastalbooks.in" },
  { id: "t6", name: "Verma & Daughters CA",    plan: "Practice",  seats: 10, seatsUsed: 9,  clientOrgs: 6, mrr: 24000,  docs7: 891,  docsToday: 102, failedDocs: 2,  state: "active",   bridge: "online",  region: "Delhi",      mailFails: 0, signedUp: "30-Oct-2024", lastSeen: "27 min ago",   trial: false, owner: "Ritu Verma",        ownerEmail: "ritu@vermadaughters.in" },
  { id: "t7", name: "Bharat Bookkeepers",      plan: "Solo",      seats: 4,  seatsUsed: 3,  clientOrgs: 2, mrr: 6400,   docs7: 122,  docsToday: 14,  failedDocs: 0,  state: "active",   bridge: "online",  region: "Jaipur",     mailFails: 0, signedUp: "14-Mar-2025", lastSeen: "5 h ago",      trial: false, owner: "Bharat Khurana",    ownerEmail: "bharat@bharatbk.in" },
  { id: "t8", name: "Sengupta CA Practice",    plan: "Practice",  seats: 14, seatsUsed: 11, clientOrgs: 9, mrr: 33600,  docs7: 1788, docsToday: 245, failedDocs: 11, state: "active",   bridge: "online",  region: "Kolkata",    mailFails: 2, signedUp: "06-Aug-2024", lastSeen: "just now",     trial: false, owner: "Indrani Sengupta",  ownerEmail: "indrani@sengupta-ca.in" },
  { id: "t9", name: "Madurai Tax House",       plan: "Solo",      seats: 2,  seatsUsed: 2,  clientOrgs: 2, mrr: 4800,   docs7: 96,   docsToday: 11,  failedDocs: 0,  state: "active",   bridge: "online",  region: "Madurai",    mailFails: 0, signedUp: "19-Dec-2024", lastSeen: "yesterday",    trial: false, owner: "Karthikeyan Iyer",  ownerEmail: "karthik@madurai-tax.in" },
  { id: "t10", name: "GreenLeaf Accountancy",  plan: "Practice",  seats: 8,  seatsUsed: 6,  clientOrgs: 4, mrr: 19200,  docs7: 423,  docsToday: 38,  failedDocs: 1,  state: "disabled", bridge: "offline", region: "Hyderabad",  mailFails: 0, signedUp: "11-Jul-2024", lastSeen: "12 d ago",     trial: false, owner: "Suresh Naidu",      ownerEmail: "suresh@greenleaf.in" },
  { id: "t11", name: "OctaPath Advisors",      plan: "Practice",  seats: 6,  seatsUsed: 6,  clientOrgs: 5, mrr: 14400,  docs7: 488,  docsToday: 52,  failedDocs: 3,  state: "active",   bridge: "online",  region: "Gurgaon",    mailFails: 1, signedUp: "27-Sep-2024", lastSeen: "8 min ago",    trial: false, owner: "Pooja Bhatia",      ownerEmail: "pooja@octapath.in" },
  { id: "t12", name: "Saraswati Audit Co",     plan: "Solo",      seats: 3,  seatsUsed: 2,  clientOrgs: 2, mrr: 0,      docs7: 21,   docsToday: 0,   failedDocs: 0,  state: "trial",    bridge: "offline", region: "Lucknow",    mailFails: 0, signedUp: "24-Apr-2026", lastSeen: "yesterday",    trial: true,  owner: "Pankaj Saraswat",   ownerEmail: "pankaj@saraswati.in" },
];

const PA_DOCS_14D = [402, 478, 511, 462, 580, 612, 488, 705, 681, 740, 812, 798, 884, 1067];
const PA_FAIL_14D = [12, 18, 9, 14, 22, 19, 11, 28, 17, 24, 31, 26, 35, 41];

const PA_FAILED_DOCS = [
  { id: "d-9921", file: "ITC-INV-2604-001.pdf",   tenant: "Patel Mehta CA LLP",  realm: "Reliance Distribution",   stage: "OCR",   reason: "Scanned image too low DPI (72 dpi)", retries: 2, age: "3 m" },
  { id: "d-9920", file: "tax-bill-april.pdf",      tenant: "Sengupta CA Practice", realm: "Aurelia Trading Pvt",      stage: "PARSE", reason: "Could not locate GSTIN on page 1",   retries: 1, age: "8 m" },
  { id: "d-9919", file: "BillFromHari.pdf",        tenant: "Khan & Associates",    realm: "Sundaram Textiles",        stage: "PARSE", reason: "Multi-page invoice with mixed currency", retries: 0, age: "14 m" },
  { id: "d-9918", file: "Reliance-2641.PDF",       tenant: "Patel Mehta CA LLP",  realm: "Reliance Distribution",   stage: "OCR",   reason: "Password-protected PDF",              retries: 3, age: "22 m" },
  { id: "d-9917", file: "PowerCorp-bill.pdf",      tenant: "Sengupta CA Practice", realm: "PowerCorp Industries",     stage: "PARSE", reason: "HSN/SAC missing on all line items",  retries: 1, age: "41 m" },
  { id: "d-9916", file: "amazon-fees-04.pdf",      tenant: "OctaPath Advisors",    realm: "Cottonway Apparel",        stage: "PARSE", reason: "Vendor GSTIN format invalid",         retries: 2, age: "1 h" },
  { id: "d-9915", file: "swiggy-april.pdf",        tenant: "Patel Mehta CA LLP",  realm: "Apex Foods Catering",      stage: "OCR",   reason: "Page rotation 90° not handled",       retries: 1, age: "1 h" },
  { id: "d-9914", file: "GMR-airport-fee.pdf",     tenant: "Sengupta CA Practice", realm: "Skyline Cargo",            stage: "PARSE", reason: "Two TDS sections inferred — needs human", retries: 0, age: "2 h" },
];

const PA_ACTIVITY = [
  { ts: "10:42:18", type: "system",  sev: "info",     tenant: null,                  msg: "Ingest pulse: 12 mailboxes polled · 47 invoices ingested" },
  { ts: "10:41:02", type: "audit",   sev: "info",     tenant: "Patel Mehta CA LLP",  msg: "Hetal Mehta added user reena.kotak@patelmehta.in (AP Clerk, 2 client orgs)" },
  { ts: "10:39:45", type: "system",  sev: "warning",  tenant: "Patel Mehta CA LLP",  msg: "Tally bridge AlterID lag 47s (threshold 30s)" },
  { ts: "10:38:01", type: "audit",   sev: "info",     tenant: "Khan & Associates",   msg: "Mahir Khan exported batch B-2604-014 · 12 vouchers · ₹ 84,12,400" },
  { ts: "10:36:22", type: "system",  sev: "critical", tenant: "Sengupta CA Practice", msg: "OCR queue: 11 documents failed in last hour (>3% rate)" },
  { ts: "10:35:09", type: "audit",   sev: "info",     tenant: "Verma & Daughters CA", msg: "Ritu Verma created client org Ananya Garments Pvt Ltd" },
  { ts: "10:32:55", type: "system",  sev: "info",     tenant: null,                  msg: "Cron: TDS section 26Q reconciliation finished · 8 tenants · 0 mismatches" },
  { ts: "10:31:14", type: "audit",   sev: "warning",  tenant: "Sengupta CA Practice", msg: "Indrani Sengupta force-rotated API key for client org Aurelia Trading" },
  { ts: "10:29:48", type: "system",  sev: "info",     tenant: "Khan & Associates",   msg: "Mailbox ap@sundaram.in: 12 new invoices ingested" },
  { ts: "10:27:19", type: "audit",   sev: "info",     tenant: "OctaPath Advisors",   msg: "Pooja Bhatia changed approval workflow for ‘Net Payable > ₹10L’" },
  { ts: "10:24:02", type: "system",  sev: "warning",  tenant: "OctaPath Advisors",   msg: "Mailbox token expiring in 9 days: vendor-bills@cottonway.in" },
  { ts: "10:21:35", type: "audit",   sev: "info",     tenant: "Khan & Associates",   msg: "Sneha Iyer reviewed and approved invoice RJIL-92834" },
];

window.PA_TENANTS = PA_TENANTS;
window.PA_DOCS_14D = PA_DOCS_14D;
window.PA_FAIL_14D = PA_FAIL_14D;
window.PA_FAILED_DOCS = PA_FAILED_DOCS;
window.PA_ACTIVITY = PA_ACTIVITY;
