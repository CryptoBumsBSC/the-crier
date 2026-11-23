# The Crier

A Telegram bot that calls out new tweets in a group, with two-tap buttons.

## What it does

1. The owner or a group admin drops a tweet link from an approved X account, with their own line.
2. The Crier replaces it with a tidy post: the tweet, the line and seven buttons (Like, Repost, Quote, Comment, Generate reply, Generate quote, I'm in).
3. The "I'm in" button shows a running line, such as "14 members are in". Each member counts once per post.
4. Edit feature: the owner or a group admin replies to the tidy post with `edit` and the new line.
5. The post is pinned for 24 hours, then The Crier unpins it.
6. The Crier only works in groups the owner added it to. Added by anyone else, it leaves.
7. Generate reply: a button on the tidy post opens a private chat with The Crier. The Crier writes one unique reply for that member, about that tweet. 8 replies out of 10 carry `#TheRiftBorn` and no other tag; the rest carry no tag. The member taps the reply to copy it, or taps "Post this reply on X". No two members get the same reply for a tweet.
8. Generate quote: the button beside Generate reply. The Crier writes one unique line for a member who quotes the tweet (shares it to their own followers), always with `#TheRiftBorn`, and half the time with one extra tag from the list. The member taps the quote to copy it, or taps "Post this quote on X". Each member can have 3 quotes per tweet, on top of their 3 replies.
9. Reminder: 6 hours before the unpin, The Crier posts one line under the tidy post, such as "14 members are in. Still time to join." The reminder is removed when the post is unpinned.
10. Owner report: the owner types `/crier report` in the private chat with The Crier. The Crier answers with the tweets dropped, the "I'm in" taps, the replies and the quotes written in the last 7 days, and the replies and quotes written in the last 24 hours out of the daily cap. Nobody else can get the report.

The Crier never signs in to X and uses no paid X access. It never posts on X. Members post their own replies.

## Settings (environment variables)

| Name | What it is |
| --- | --- |
| `BOT_TOKEN` | The token BotFather gives for the bot |
| `DATABASE_URL` | Postgres connection string. The Crier only uses tables that start with `crier_` |
| `WEBHOOK_SECRET` | Any long random text. Proves an event really came from Telegram |
| `SETUP_KEY` | Any long random text. Protects the setup page |
| `CRON_SECRET` | Any long random text. Vercel uses it to run the unpin timer |
| `ANTHROPIC_API_KEY` | Optional. The AI key for Generate reply and Generate quote. Without it, those two buttons are hidden and everything else works |
| `AI_MODEL` | Optional. Default: `claude-haiku-5-5` |
| `APPROVED_X_ACCOUNTS` | Optional. Default: `TheRiftBorn,LegitFomoDaily,Boomer_Au` |
| `OWNER_USERNAMES` | Optional. Default: `aussieboomer` |

## Two files the owner can edit

- `project-facts.js` - the fact sheet. The AI knows only what is written here, plus the tweet.
- `crier-settings.js` - the tags and how often they are added, the 3-replies and 3-quotes-per-member limits, the daily cap of 300 replies and quotes added together, and the reminder time (6 hours before the unpin; 0 switches the reminder off).

## Go live

1. Put these files in a GitHub repository and connect it to Vercel.
2. Save the settings above in the Vercel project, then redeploy.
3. Open `https://YOUR-ADDRESS/api/setup?key=YOUR_SETUP_KEY` once. It should end with "The Crier is set up."
4. The owner adds the bot to a group and makes it an admin with two rights: Delete messages, Pin messages.

Backup switch: if the bot is in a group but stays silent, the owner types `/crier on` in that group.

## Files

- `lib/crier.js` - the rules above
- `lib/x.js` - reading tweet links, the button links, checking who wrote a tweet
- `lib/reply.js` - instructions for the AI, and the code that guarantees the tags and the 280 limit
- `lib/ai.js` - the call to the AI
- `lib/store-pg.js` - the database
- `api/telegram.js` - where Telegram sends events
- `api/cron.js` - the unpin timer and the reminder, every 5 minutes
- `api/setup.js` - the setup page
- `test/` - automated tests (`npm test`)

## Known limits

- "I'm in" runs on trust. The Crier cannot check what a member did on X.
- The tweet preview (text and picture) is drawn by Telegram. If it shows no picture, drop the link as the caption of a picture instead.
- If many members tap "I'm in" in the same second, the running line can lag by a few and catches up on the next tap. The stored count is always right.
- Generate reply reads the tweet's words, not its picture. For a picture-only tweet, the owner's line should say what the picture shows.
- A member must tap Start in the private chat the first time. Telegram requires this before a bot can message someone.
- "Post this reply on X" and "Post this quote on X" rely on X accepting pre-filled words. If X ignores the pre-filled words, the member taps the reply or quote to copy it and pastes it.
- After an update, the setup page does not need to be opened again. The Crier adds any new database columns by itself the first time it runs.
