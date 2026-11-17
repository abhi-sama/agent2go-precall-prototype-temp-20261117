# Earlier conversations are listed by thread in the BE and reopened through AppSync

Ask the agent kept only the current thread in `sessionStorage`, so a person could not go back to a conversation they had finished. The panel, the docked sidebar and `/chat` now show a list of the person's earlier conversations, newest first, each titled by its first question and dated, and reopen one with its saved answers.

## The list is built where the data is, not in the browser

The agent saves each finished turn to FE DynamoDB under `pk = USER#<userId>`, `sk = THREAD#<threadId>#<time>#<runId>` (ADR 0005). That key orders a person's turns by **thread id**, which is a random UUID, not by time. The first history query (`myChatHistory`, a `Limit`-ed descending read) therefore returned the turns of whichever threads sorted last, not the newest. It could not back a list, so it is replaced by two queries on the same route (browser → FE AppSync → BE Lambda, ADR 0001, ADR 0007):

- `myChatThreads(limit)` reads the caller's turns with a projection of only the fields a list needs, groups them by thread in the BE, and returns one `{ threadId, title, startedAt, updatedAt, turnCount }` per conversation, most recently active first. The title is the earliest question, whitespace-collapsed and cut at 80 characters. The read follows DynamoDB's pages up to 2000 turns (a year's retention of one person's questions stays well inside that); past it the oldest-keyed threads drop out and the BE logs that it truncated.
- `myChatThread(threadId)` reads one thread by the key prefix `THREAD#<threadId>#`, newest 100 turns, returned oldest first, with the same `SavedChatTurn` shape the browser already rebuilds into messages.

A list that needs no new table or index: a time-ordered index would be a migration on a table that is retained, for a list that is read when the person opens it.

## Ownership and scope are decided in the BE

- The partition key is built in the BE from the verified caller (ADR 0002). Neither query takes a user id, and `threadId` is validated against `[A-Za-z0-9_-]{8,64}` before it is part of a key prefix, so it can only narrow a search inside the caller's own partition. The narrow read role (`dynamodb:Query` only) is unchanged.
- Each turn carries the territories its answer was counted in. A turn whose territories are no longer all inside the caller's current RLS scope, and a turn saved before that snapshot existed, is neither listed nor returned, and does not count in a thread's turn count; a thread with no readable turn is not listed. An aggregate-only Executive (no `source.records.read`) gets nothing, because a saved answer can carry record citations.
- The browser checks the rows again (`lib/chat/threads.ts`) and rebuilds the messages with the same code that restores a conversation after a reload (`messagesFromHistory`): evidence becomes activity messages that every renderer validates before drawing.

## Reopening continues the conversation

Opening a conversation sets the agent's messages to the saved turns and its thread id to theirs. It is then an ordinary thread: the next question carries the last three finished turns as history exactly as a live thread's does (`historyOf`), and the BE saves it under the same thread id, so the conversation moves to the top of the list. A reopened answer shows its figures, citations, charts and A2UI surfaces where the saved payload carries them; the tool-call rows are not saved and do not come back. Rebuilding an answer also had to add the **head** activity (figures and charts sit before the text, ADR 0018), which a restored answer previously lacked.

CopilotKit clears a chat's messages when its thread id changes under it, which would wipe a conversation just put back. The chat is therefore keyed by a counter that moves each time a saved conversation is opened, so a reopened conversation is a new CopilotKit chat ("New conversation" keeps relying on CopilotKit's own clearing). That is also the only reason the session store now carries the thread in a ref: the messages and the thread id they belong to must move in one step, or a reload would restore one conversation's messages under another's id. After a reload the newest conversation is restored from the same two queries when the tab's `sessionStorage` is empty.

## The list in CopilotKit's design, nothing sent to CopilotKit

CopilotKit's open-source `CopilotPopup`, `CopilotSidebar` and `CopilotChat` have no thread list. The ones in the package (`useThreads` and `CopilotThreadsDrawer`, `@copilotkit/react-core` 1.88.0) are the CopilotKit Intelligence client: `useThreads` lists, renames, archives and deletes threads "on the platform" for a "runtime-authenticated user" (it needs a runtime URL and fails without one), and the drawer shows a locked view without an Intelligence entitlement. Using them would mean a runtime endpoint, a licence and conversations stored on CopilotKit's servers, all of which ADR 0018 rules out. What does fit is its thread model: the chat configuration's thread id, which the list sets. The list itself is built with the chat's own tokens and controls (`components/chat/conversation-history.tsx`):

- **Panel and docked sidebar:** a "Conversations" button in the panel header opens the list as a view over the whole panel, with a visible back control ("Back to conversation") and "New conversation". Everything behind it is `inert`, focus moves into it and returns to the header button when it closes, and Escape goes back one step. The list is route-bound like the panel: closing the panel or leaving the screen shows the conversation again next time.
- **Full page:** the list is a column beside the chat from 768px (so on every iPad), and the same view over the chat below that, opened from a "Conversations" button.

Out of scope, as asked: deleting, renaming, sharing and searching conversations, and the separate agent memory feature.

## Testing

- `backend/lambdas/api/tests/test_chat_history.py`: grouping and ordering by newest turn (not by key), titles, scope re-checks per turn, the limit, an aggregate-only Executive, the thread id check, key prefixes, pagination, and that a failed read is reported without its text.
- `frontend/src/lib/chat/threads.test.ts`, `persistence.test.ts`, `appsync-agent.test.ts`, `graphql-adapter.test.ts`: the list, dates, reopening through the mock adapter (answers, citations, charts, Adjust surface), another person's and another thread's turns, and the next question sending the earlier turns as context.
- `frontend/e2e/copilot-chat.spec.ts`: on both iPad Air 11 orientations and the MacBook sizes, ask, start a new conversation, reopen the first from the panel and see its answer, then continue it; and the same from the full page's list.
