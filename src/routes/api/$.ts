import { createFileRoute } from "@tanstack/react-router";
import { handleAPI } from "../../../backend/api";
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAPI(request),
      POST: ({ request }) => handleAPI(request),
      PUT: ({ request }) => handleAPI(request),
      PATCH: ({ request }) => handleAPI(request),
      DELETE: ({ request }) => handleAPI(request),
    },
  },
});
