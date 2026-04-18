db = db.getSiblingDB("ledgerbuddy");
db.createUser({
  user: "ledgerbuddy_app",
  pwd: "ledgerbuddy_local_pass",
  roles: [{ role: "readWrite", db: "ledgerbuddy" }]
});
