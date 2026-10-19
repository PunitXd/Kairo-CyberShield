// MongoDB `kairo` database (ARCH §8.2). The Defender's Mongo user can only
// reach this database, so it physically cannot read CypherFy's messages.

import { MongoClient } from 'mongodb';

const DAYS_30 = 30 * 24 * 3600;

export const connectMongo = async (uri) => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'kairo-defender' });
  await client.connect();
  const db = client.db(); // database from the URI path: kairo
  const incidents = db.collection('incidents');
  const actions = db.collection('actions');

  await Promise.all([
    incidents.createIndex({ status: 1, detectedAt: -1 }),
    incidents.createIndex({ subject: 1 }),
    incidents.createIndex({ ruleId: 1, detectedAt: -1 }),
    incidents.createIndex({ detectedAt: 1 }, { expireAfterSeconds: DAYS_30 }),
    actions.createIndex({ incidentId: 1 }),
    actions.createIndex({ appliedAt: -1 }),
    actions.createIndex({ requestedAt: 1 }, { expireAfterSeconds: DAYS_30 }),
  ]);

  return { client, db, incidents, actions };
};
