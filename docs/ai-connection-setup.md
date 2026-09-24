# Connecting PSI-88L to Grok

PSI-88L is the application/workspace name. The Model ID field identifies the model offered by your API provider; it is not the name of a custom project created on Grok's website.

1. Open **Settings** and select **xAI — Grok API**.
2. Enter an API model ID available to your xAI account. As verified on September 24, 2026, xAI documents `grok-4.7` with Chat Completions support: [official model documentation](https://docs.x.ai/developers/grok-4-7).
3. Enter an API key from the [xAI API console](https://console.x.ai). When keeping the same connection, leave the key blank to retain the saved key.
4. Choose **Save connection**, then **Check saved connection**. The check verifies the key and model listing without submitting documents or generating an answer.
5. Return to the Desk and ask a question grounded in a published manual.

A successful connection check does not validate generation, vision support, or available billing credits. If the model is not listed, copy its exact ID from the provider console. If the key is rejected, check the key's account and permissions. Billing and rate-limit errors require checking the provider account.

The application retains and retrieves its own published Library evidence. Connecting an API model does not automatically import a Grok project's instructions, files, or conversations. Your local Library remains available when you change AI providers.

The Desk now dedicates the main area to conversation. Expand **View source references** below an answer when you want to open the evidence in the Library.
