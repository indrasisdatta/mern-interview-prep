# Infinite Scroll for a Feed

Questions:

1. Device - web/mobile?
2. Content type  image, text, video
3. How many items to load?
4. Real time updates?
5. Interactions - like, share, comments?


**Functional Requirements:**

1. Show dynamic user feed (latest 10 items)
2. Infinite scroll for pagination - new items appear when scroll down the page
3. Feed can have image, title, brief description along with user avatar
4. Show "new items" notification at the top when new post is added
5. Like, share, comments feature

**Non-functional Requirements:**

1. Responsive 
2. Accessibility
3. Caching
4. Loading, error, success states
5. Asset optimization


**Component Design:**

NewsFeeds 

- NewsFeed[] 
NewsFeed

- userAvatar
- heading
- content
    - type: image | video | text 

- feedActions
    - onClickLike
    - onClickComment
    - onClickShare



**Data Modeling**

NewsFeed 

```
﻿id: string;
author: User;
title: string;
createdAt: Date;
updatedAt: Date;
description: string;
attachments: string[];
likeCount: number;
commentCount: number;
shareCount: number;

User {
  id: string
  email: string
  firstName: string
  lastName: string
  avatar: string
}

 
```
```
// cursor pagination
{
  "feeds": [],
  "pageInfo": {
    "hasNext": boolean,
    "cursor": unique-id
  }
}

// offset pagination
{
  "feeds": [],
  "offset": 0,
  "limit": 10
}
```
**API Design **

REST   

- METHOD: GET 
- URL: /news-feed?offset=0&limit=10
GraphQL (mention only specific fields )

- METHOD: POST
- URL:  /graphql
```
 query {
   getAllNewsFeed (cursor: string) {
      id,
      author {
        id, firstName, lastName, avatar
      },
      title,
      createdAt,
      description,
      attachments,
      likeCount,
      commentCount,
      shareCount
   }
 }
```
Real time updates

- Server-sent events
- Long polling
- Web sockets
- Subscriber (using GraphQL)


**Performance Optimization**

- Virtualization/Intersection Observer (React virtualized/React window)
- Code splitting
- Preload
- Bundling (tree-shaking)










