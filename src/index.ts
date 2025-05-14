import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Hono } from "hono";
import { layout, homeContent } from "./utils";
import { introspectEndpoint } from "./introspection";
import { parse } from "graphql/language";

type Bindings = Env;

const app = new Hono<{
  Bindings: Bindings;
}>();

type Props = {
  bearerToken: string;
  graphqlEndpoint: string;
};

type State = {
  schema?: string;
};

export class MyMCP extends McpAgent<Bindings, State, Props> {
  server = new McpServer({
    name: "Demo",
    version: "1.0.0",
  });

  initialState = {
    schema: undefined,
  };

  async init() {
    this.server.resource(
      "graphql_schema",
      `mcp://resource/graphql_schema`,
      async (uri: URL) => {
        if (!this.state.schema) {
          const schema = await introspectEndpoint(
            new URL(this.props.graphqlEndpoint).href,
            { Authorization: `Bearer ${this.props.bearerToken}` }
          );
          this.setState({ ...this.state, schema });
        }

        const schema = this.state.schema ?? ""; // Ensure schema is a string

        return {
          contents: [{ uri: uri.href, text: schema }],
        };
      }
    );

    this.server.tool(
      "graphql-schema",
      "Get the GraphQL schema for the given endpoint",
      {},
      async () => {
        const schema = await introspectEndpoint(
          new URL(this.props.graphqlEndpoint).href,
          { Authorization: this.props.bearerToken }
        );
        return {
          content: [
            {
              type: "text",
              text: schema,
            },
          ],
        };
      }
    );

    this.server.tool(
      "query-graphql",
      "Query a GraphQL endpoint with the given query and variables",
      {
        query: z.string(),
        variables: z.string().optional(),
      },
      async ({ query, variables }) => {
        try {
          const parsedQuery = parse(query);

          // Check if the query is a mutation
          const isMutation = parsedQuery.definitions.some(
            (def) =>
              def.kind === "OperationDefinition" && def.operation === "mutation"
          );

          if (isMutation) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Mutations are not allowed unless you enable them in the configuration. Please use a query operation instead.",
                },
              ],
            };
          }
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Invalid GraphQL query: ${error}`,
              },
            ],
          };
        }

        try {
          const response = await fetch(this.props.graphqlEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: this.props.bearerToken,
            },
            body: JSON.stringify({
              query,
              variables,
            }),
          });

          if (!response.ok) {
            const responseText = await response.text();

            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `GraphQL request failed: ${response.statusText}\n${responseText}`,
                },
              ],
            };
          }

          const data = (await response.json()) as { errors?: any[] };

          if (data.errors && data.errors.length > 0) {
            // Contains GraphQL errors
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `The GraphQL response has errors, please fix the query: ${JSON.stringify(
                    data,
                    null,
                    2
                  )}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          throw new Error(`Failed to execute GraphQL query: ${error}`);
        }
      }
    );
  }
}

// Render a basic homepage placeholder to make sure the app is up
app.get("/", async (c) => {
  const content = await homeContent(c.req.raw);
  return c.html(layout(content, "MCP Remote Auth Demo - Home"));
});

const envSchema = z.object({
  AUTH_TOKEN: z.string(),
  GRAPHQL_ENDPOINT: z.string(),
});

app.mount("/", (req, env: Bindings, ctx) => {
  // This could technically be pulled out into a middleware function, but is left here for clarity

  const { AUTH_TOKEN, GRAPHQL_ENDPOINT } = envSchema.parse(env);

  ctx.props = {
    bearerToken: `Bearer ${AUTH_TOKEN}`,
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    // could also add arbitrary headers/parameters here to pass into the MCP client
  };

  return MyMCP.mount("/sse").fetch(req, env, ctx);
});

export default app;
