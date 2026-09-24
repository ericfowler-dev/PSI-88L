import { createFileRoute } from "@tanstack/react-router";
import { handleAPI } from "../../../backend/api";
export const Route = createFileRoute("/api/chat")({
  server: { handlers: { POST: ({ request }) => handleAPI(request) } },
});
