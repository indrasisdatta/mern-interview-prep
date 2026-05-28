```text
1) Find all Electronics that have less than 20 items in stock for the "Black" variant.
    WRONG: variants: [{}...] may not meet both conditions color and stock 
    db.products.find({
        "category": "Electronics", 
        "variants.color": "Black",  
        "variants.stock": {"$lt" : 20 }
    })
    CORRECT: use $elemMatch 
    db.products.find({
        "category": "Electronics",
        "variants": {
            "$elemMatch": {
                "color": "Black",
                "stock": {"$lt": 20}
            }
        }
    })


2) Find all users living in London or Tokyo who are not subscribed to the newsletter.
    // Both are correct approach
    db.users.find({
        "address.city": {"$in": ["London", "Tokyo"]},
        "preferences.newsletter": true
    })
    db.users.find({
        "$or": [
            {"address.city": "London"}
            {"address.city": "Tokyo"}
        ],
        "preferences.newsletter": true
    })

3) Find the 5 most recent orders with a totalAmount greater than 300, and only show the orderNum and totalAmount fields.
    db.orders.find(
        {"totalAmount": { $gt: 300 }},
        {"orderNum": 1, "totalAmount": 1, "_id": 0}
    )
    .sort({"orderDate": -1})
    .limit(5)

4) Revenue Analysis Find the total revenue and average order value for each City.
    db.orders.aggregate([
        {
            "$lookup": {
                "from": "users",
                "localField": "userId",
                "foreignField": "_id",
                "as": "userOrders"
            }
        },
        { "$unwind": "$userOrders" },
        {
            "$group": {
                "_id": "$userOrders.address.city",
                "totalRevenue": {$sum: "$totalAmount" },
                "avgRevenue": {$avg: "$totalAmount"},
                "countOrders": {$sum: 1}
            }
        },
        { "$sort": {"totalRevenue" : -1} }
    ])


5) Product Performance Find the top 3 products (SKUs) that have been ordered the most by quantity.

    db.orders.aggregate([
        {"$unwind": "$items"},
        {
            "$group": {
                "_id": "$items.sku", 
                "totalQty": {"$sum": "$items.qty"}  
            }
        },
        {"$sort": {"totalQty": -1}},
        {"$limit": 3},
        {"$project": {"sku": "$_id", "totalQty": 1, "_id": 0}}    
    ])


/* Total order amount of Returned items in Jan 2024 */
db.orders.aggregate([
    {
        $match: {
            status: "Returned", 
            orderDate: { $gte: ISODate("2024-01-01"), $lt: ISODate("2024-02-01") },
//            $expr: {
//                $eq: [ {$month: "$orderDate"}, 1 ],
//                $eq: [ {$year: "$orderDate"}, 2024 ] 
//           }
        }
    },
    {$group: {_id: null, total: {$sum: "$totalAmount"}}}
]);


====================================================================

Indexing:
For large datasets, MongoDB queries can become slow because the database performs a full collection scan. 
To optimize performance, we create indexes on fields frequently used in find, sort, and early aggregation stages. 
MongoDB uses B-tree indexes, and compound indexes follow the leftmost prefix rule, so the query pattern must align with the index order. 
However, over-indexing increases storage and slows write operations because indexes must be updated on every data change.
    - Single field 
    - Compound index: on multiple fields 
    - Multikey index: on arrays 
    - Text index: enables full text search 
        db.books.createIndex({title: "text"})
        // This query will return all books in the “books” collection that contain the words “Great” and “Gatsby” in the “title” field.
        db.books.find({$text: {$search: "Great Gatsby"}})

====================================================================

MongoDB Questions:

1) Why index order matters?
- MongoDB uses B tree indexes
- Prefix rule - can use index from the leftmost prefix 
    db.users.createIndex({ status: 1, createdAt: -1 })
    // Uses index 
    db.users.find({ status: "Active" })
    db.users.find({ status: "Active", createdAt: {$gt: date} })
    // Cannot fully use index 
    db.users.find({ createdAt: {$gt: date} })
- Order should be -> equality, range, sort 
    db.users.find({ 
        status: "Active", 
        createdAt: {$gt: date} 
    }).sort({ createdAt: -1 })
- Place high cardinality keys first i.e more unique     
    e.g. userId, gender (not gender, userId)
- Sorting depends on index order, otherwise cause in-memory sort 
    db.users.createIndex({ createdAt: -1 })
    db.users.find({}).sort({ createdAt: 1 }) // In memory sort 

2) Why skip is slow?
 - MongoDB has to sequentially scan and discard the skipped documents first, even if index exists 
 - O(skipped + limit)

3) When to use aggregation vs find?
- Use find() for simple document retrieval with filtering and projection 
- Use aggregatetion pipeline when you need grouping, join, computed fields or multi-stage data transformation
In Aggr pipeline - memory can be high (requires $allowDiskUse for large sets)

4) Embedded vs reference?
 - Embedded stores data inside the same document. Used when data is frequently read together, child data is small, low update frequency. Atomic parent child update.  
 - Reference stores data in separate collection and links via IDs. Use when data grows unbounded, child updates frequently. But causes slower reads.
Max BSON document size = 16MB, so use reference if collection keeps growing 

5) How to handle millions of records?
 - Proper indexing 
 - Schema design (embed read-heavy small docs, reference large docs)
 - Connection pooling (improves throughput and prevents connection overhead )
 - Pagination (use cursor based for > 1000 records)
 - Sharding for horizontal scaling big datasets 
 - Caching (Redis)

6) How to paginate efficiently?
 - Cursor based pagination 
   db.users.find({ timestamp: {$lt: lastTimestamp} }).sort({ timestamp: -1 }).limit(10)

7) Why index is not used sometimes?
 - If filter matches a large portion of the collection, COLLSCAN is used 
 - Type mismatch (Query uses string instead of number)
 - Sort order not matching 
// verify with .explain("executionStats")
// Check COLLSCAN vs IXSCAN in the execution plan

8) How to optimize slow Mongo query?
 - Proper indexing 
 - Schema design (embed read-heavy small docs, reference large docs)
 - Projection (return fewer fields)
 - Connection pooling (improves throughput and prevents connection overhead )
 - Pagination (use cursor based for > 1000 records)
 - Sharding for horizontal scaling big datasets 
 - Caching (Redis)

9) How to design many to many relationship?
    https://www.mongodb.com/company/blog/building-with-patterns-the-subset-pattern

    Customer → Orders,  User → Posts, Product → Reviews, Chat → Messages

    MongoDB subset pattern: 
     - embed recent orders in Customer for fast reads  
     - store full order history in a separate Orders collection to avoid unbounded document growth

    Customer collection:
        {
            _id: "cust1",
            name: "John",
            recentOrders: [
                { orderId: "o101", amount: 200 },
                { orderId: "o102", amount: 150 }
            ],
            hasMoreOrders: true
        }
    Orders collection: { _id: "o101",customerId: "cust1", amount: 200, items: [...] }

    const orderSummary = { orderId: "o101", amount: 200, status: "PLACED",createdAt: new Date() };

    For write - use multi-document transaction 
        session.startTransaction();
        await Orders.insertOne(orders, {session});
        await Customers.updateOne(
            {_id: custId},
            {
                $push: { 
                    recentOrders: {
                        $each: [orderSummary], $slice: 5
                    }
                },
                $inc: { totalOrderValue: orderSummary.amount }
            },
            {session}
        )

===============================================================

Cursor based pagination - handling duplicate timestamps 

db.getCollection("transactions").find({
    $or: [
        { bucket_end_date: {$gt: new Date("2017-01-01")} },
        { bucket_end_date: new Date("2017-01-01"), _id: {$gt: ObjectId("5ca4bbc1a2dd94ee58161d08")} }
    ]    
})
.sort({bucket_end_date: 1})
.limit(10)

=================================================================

$match
$group
$lookup
$project  $addFields
$sort
$limit
$unwind

$facet
```