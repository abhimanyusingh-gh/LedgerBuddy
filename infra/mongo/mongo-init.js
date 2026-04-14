db = db.getSiblingDB("billforge");
db.createUser({
  user: "billforge_app",
  pwd: "billforge_local_pass",
  roles: [{ role: "readWrite", db: "billforge" }]
});
