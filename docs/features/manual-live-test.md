# Manual Live Test

The live-test script is manual only. It is not scheduled by Docker Compose.

Run it with:

```bash
TEST_DISCORD_TOKEN=temporary_test_bot_token npm run live-test
```

The script posts test steps, including an image attachment, to the configured general channel and checks whether the main TTC bot acknowledged recent feedback.

Required environment variables for manual testing:

- `TEST_DISCORD_TOKEN`
- `TEST_GUILD_ID`, optional
- `TEST_GENERAL_CHANNEL_ID`, optional
