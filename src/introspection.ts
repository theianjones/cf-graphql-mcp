import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
/**
 * Introspect a GraphQL endpoint and return the schema as the GraphQL SDL
 * @param endpoint - The endpoint to introspect
 * @returns The schema
 */
export async function introspectEndpoint(
  endpoint: string,
  headers?: Record<string, string>
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      query: getIntrospectionQuery(),
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`);
  }

  const responseJson = (await response.json()) as { data: any };
  // Transform to a schema object
  const schema = buildClientSchema(responseJson.data);

  // Print the schema SDL
  return printSchema(schema);
}
