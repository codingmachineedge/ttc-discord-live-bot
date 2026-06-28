#!/usr/bin/env node

const token = process.env.TEST_DISCORD_TOKEN;
const guildId = process.env.TEST_GUILD_ID;
const channelId = process.env.TEST_GENERAL_CHANNEL_ID;

if (!token) {
  throw new Error("TEST_DISCORD_TOKEN is required.");
}

const api = "https://discord.com/api/v10";

async function discord(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
  }
  if (response.status === 204) {
    return undefined;
  }
  return response.json();
}

async function resolveGuild() {
  if (guildId) {
    return { id: guildId };
  }
  const guilds = await discord("/users/@me/guilds");
  if (!guilds.length) {
    throw new Error("Test bot is not in any guilds.");
  }
  return guilds[0];
}

async function resolveGeneralChannel(guild) {
  if (channelId) {
    return { id: channelId, name: "configured" };
  }
  const channels = await discord(`/guilds/${guild.id}/channels`);
  const general = channels.find((channel) => channel.type === 0 && channel.name?.toLowerCase() === "general")
    ?? channels.find((channel) => channel.type === 0);
  if (!general) {
    throw new Error("No text channel found for live testing.");
  }
  return general;
}

async function send(channel, content) {
  return discord(`/channels/${channel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

async function sendImageStep(channel, content) {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lBvY7wAAAABJRU5ErkJggg==";
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content,
    attachments: [{ id: "0", filename: "live-test-image.png" }]
  }));
  form.append("files[0]", new Blob([Buffer.from(pngBase64, "base64")], { type: "image/png" }), "live-test-image.png");

  const response = await fetch(`${api}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST image step failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function main() {
  const guild = await resolveGuild();
  const channel = await resolveGeneralChannel(guild);
  const runId = new Date().toISOString();

  const steps = [
    `Live test ${runId}: test bot connected and found #${channel.name}.`,
    `Live test ${runId}: checking that the TTC bot reads general-channel feedback and pings back.`,
    `Live test ${runId}: feedback sample for TTC bot. Please acknowledge this general-channel message.`,
    `Live test ${runId}: checking that long operational updates can be sent safely without secrets.`,
    `Live test ${runId}: live-test messages complete.`
  ];

  for (const step of steps) {
    await send(channel, step);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await sendImageStep(channel, `Live test ${runId}: image/file attachment test for TTC bot feedback pickup.`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await send(channel, `Live test ${runId}: leaving eastbound from Eglinton. Please recommend the lowest-wait trip.`);
  await new Promise((resolve) => setTimeout(resolve, 30000));

  const messages = await discord(`/channels/${channel.id}/messages?limit=30`);
  const acknowledgements = messages.filter((message) =>
    message.content?.includes("picked up and read. Feature change, fix, or feedback acknowledged.")
  );
  const recommendations = messages.filter((message) =>
    message.content?.includes("recommended eastbound trip from **Eglinton Station**")
  );
  console.log(JSON.stringify({
    guildId: guild.id,
    channelId: channel.id,
    sentSteps: steps.length + 2,
    imageMessagesSeen: messages.filter((message) => message.attachments?.length).length,
    acknowledgementsSeen: acknowledgements.length,
    recommendationsSeen: recommendations.length,
    recommendationGifsSeen: recommendations.filter((message) =>
      message.attachments?.some((attachment) => attachment.filename?.endsWith(".gif"))
    ).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
