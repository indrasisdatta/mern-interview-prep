# Notification System

**Functional Requirements:**

1. Bell icon with unread message count
2. On click actions:
- redirect to new page
- mark notification as read 
- update the count
3. Real time update when new notification arrives (both count and message)


**Non-functional Requirements:**

1. Responsive
2. Accessibility
3. All tabs/device should be in sync
4. Security
5. Scalability (handle multiple websocket connections)
6. Reliability (fallback and reconnect strategy)


**Component Design:**

```
<Notification />  
```
Manages fetching notifications, websocket connection and synching unread count.

```
<NotificationBadge 
  count={4} 
  onClick={openList} 
/>
```
```
﻿<NotificationList
  notifications={[]}  
  onItemClick={markAsRead}
/> 
```
```
interface Notification {
  id: string
  text: string
  avatar: string
  url: string  
  isRead: boolean
  createdAt: string;
}
```
**API Design:**

GET    /notifications?cursor=123&limit=10

```json
{
  "total": 50,
  "cursor": 123,
  "hasNext": true,
  "notifications": [
    {
      "id": "123",
      "text": "You have a new message",
      "avatar": "https://...",
      "url": "/message/123",
      "isRead": false,
      "createdAt": ""
    }
    
  ]
}
```
POST    /notification/read

Called during on click event of a notification item

Payload:

```
{ 
     "notificationId": "123..", 
     isRead: true 
}
```
Response:   200

```
{ 
     "notificationId": "123..", 
     isRead: true 
}
```
FE updates unread count optimistically. 

BE returns updated count for consistency.



**Real time notification workflow:**

1. During initial page load, connect to web socket endpoint.   wss://..notifications
2. Make API call to retrieve the latest notification count and messages
3. When new notification is received, BE publishes it to a message broker (Kafka/Redis pub sub)
4. Websocket gateway pushes the event to connected clients
5. FE receives the event and:
- Prepends the new notification
- Increments unread count
- Broadcasts updates to other tabs using BroadcastChannel
6. When user opens notification:
- Update UI optimistically
- Call /message/read API call to update read status
- Other tabs receive update via BroadcastChannel, WebSocket event

**Performance Optimization:**

1. Asset optimization for avatar image (Use webp/avif)
2. When message is clicked, update the count optimistically for better user experience 
3. Show up to 10 notification list with a "view more" link which opens all notifications in a new page.
4. Read React query for caching, deduplication, background refetch, retry handling
5. Throttle UI updates if many notifications arrive rapidly
6. Use SharedWorker to create only 1 websocket connection across all tabs


**Error handling and reliability:**

1. Auto-connect websocket (exponential back-off)
2. Fallback to polling in case of websocket error


**Monitoring and logging:**

1. Sentry/Data dog to log WS connection errors


---

SharedWorker allows all browser tabs to share a single WebSocket connection. Instead of each tab creating its own WebSocket, the worker holds one connection and broadcasts messages to every tab. This reduces backend load, eliminates duplicated events, and keeps all tabs perfectly synchronized**NOTES FOR REFERENCE**

SharedWorker:

- allows all browser tabs to share a single WebSocket connection. 
- Instead of each tab creating its own WebSocket, the worker holds one connection and broadcasts messages to every tab. 
- This reduces backend load, eliminates duplicated events, and keeps all tabs perfectly synchronized


QUESTIONS:

How to implement exponential-backoff in websocket connection?



How to avoid duplicate notifications?



How to avoid stale data when caching notifications?



Why use cursor-based pagination instead of offset based?



What if mark as read API fails?



How to ensure correct ordering of notifications?



How to test websocket UI?



How to handle rate limiting? 





