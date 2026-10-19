// Runs once, on the first start of an empty mongo-data volume
// (docker-entrypoint-initdb.d, as the root user).
//
// Least privilege (ARCH §12): CypherFy can only touch `cypherfy`, the Defender
// can only touch `kairo`. The Defender physically cannot read messages.
// Each user lives in its own database, which is the authSource its URI uses.

const cypherfyPassword = process.env.CYPHERFY_DB_PASSWORD;
const kairoPassword = process.env.KAIRO_DB_PASSWORD;

if (!cypherfyPassword || !kairoPassword) {
  throw new Error('CYPHERFY_DB_PASSWORD and KAIRO_DB_PASSWORD must be set for mongo init');
}

db.getSiblingDB('cypherfy').createUser({
  user: 'cypherfy_app',
  pwd: cypherfyPassword,
  roles: [{ role: 'readWrite', db: 'cypherfy' }],
});

db.getSiblingDB('kairo').createUser({
  user: 'kairo_defender',
  pwd: kairoPassword,
  roles: [{ role: 'readWrite', db: 'kairo' }],
});

print('mongo init: created cypherfy_app (cypherfy) and kairo_defender (kairo)');
