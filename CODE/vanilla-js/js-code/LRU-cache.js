/**
 * LRU cache implementation 
 * Keep - recently used i.e added/retrieved keys 
 * Remove - oldest used (added/retrieved)
 *   Get - Delete old, set latest key 
 *   Set - 
 * 
 */
const LRUCache = (MAX_SIZE) => {
  const cacheMap = new Map();
  
  return {
    getData(key) {
      // Key doesn't exist, return immediately
      if (!cacheMap.has(key)) return null;

      // Delete prev entry and set to maintain insert order
      let val = cacheMap.get(key);
      cacheMap.delete(key) && cacheMap.set(key, val);
      return val;
    },
    setData(key, value) {
      // Delete old occurence
      if (cacheMap.has(key)) {
        cacheMap.delete(key);
      } 
      // Limit reached - delete the first element
      else if (cacheMap.size === MAX_SIZE) {
        let firstKey = cacheMap.keys().next()?.value;
        cacheMap.delete(firstKey);
      }
      return cacheMap.set(key, value);
    },
    lruData() {
      return [...cacheMap.entries()];
    }
  }
}

const lruData = LRUCache(3);
lruData.setData('2', '2 value');
lruData.setData('3', '3 value');
lruData.setData('1', '1 value');
lruData.setData('4', '4 value')
lruData.setData('2', '2 updated value');

// Expected - 1 => '1 value', 4 => '4 value', 2 => '2 updated value'
console.log('1. LRU data: ', lruData.lruData());

lruData.getData('2');
lruData.getData('1');
lruData.setData('5', '5 value');

// Expected - 2 => '2 updated value', 1 => '1 value', 5 => '5 value'
console.log('2. LRU data: ', lruData.lruData());