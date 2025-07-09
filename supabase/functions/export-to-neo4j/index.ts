// In the section where we construct the endpoint URL:
let NEO4J_HTTP_TRANSACTION_ENDPOINT: string;
try {
  const url = new URL(NEO4J_CONNECTION_URI);
  if (url.protocol === 'neo4j+s:') {
    // For AuraDB, the HTTP endpoint follows this pattern:
    NEO4J_HTTP_TRANSACTION_ENDPOINT = `https://${url.hostname}:7473/db/neo4j/tx`;
  } else if (url.protocol === 'https:') {
    NEO4J_HTTP_TRANSACTION_ENDPOINT = `${url.origin}/db/neo4j/tx`;
  } else {
    throw new Error(`Unsupported protocol`);
  }
} catch (e) {
  throw new Error(`Invalid URI format`);
}