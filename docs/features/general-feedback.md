# General Feedback

The bot listens for messages in `GENERAL_CHANNEL_ID` when configured, or in channels named `general` otherwise.

When it sees a message from a real user, it replies:

```text
picked up and read. Feature change, fix, or feedback acknowledged.
```

Acknowledgements are rate-limited per user per server so a busy general chat is not flooded.

General-channel recommendation phrases such as `leaving eastbound from Eglinton` are handled before the generic acknowledgement reply.
