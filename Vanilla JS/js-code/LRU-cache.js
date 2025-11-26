/**
 * Create a Utility class for a LRU
 * It should store only the least recently used values (recently stored and accessed)
 * If max size is reached, old values should be removed
 */
const LRUUtil = (MAX_CACHE_SIZE) => {
  const mapData = new Map();
  const getData = (k) => {
      // Data doesn't exist
      if (!mapData.has(k)) {
        return null;
      }
      // First delete key, then re-insert same key 
      // (to maintain insertion order as per recently used)
      const val = mapData.get(k);
      mapData.delete(k) && mapData.set(k, val);
      return val;
  }
  const setData = (k, v) => {
      let delKey = null;
      // Key already exists, so remove old occurrence
      if (mapData.has(k)) {
          delKey = k;
      }
      // Max size reached, remove oldest key
      else if (mapData.size >= MAX_CACHE_SIZE) {
          const firstKey = mapData.keys().next()?.value;
          delKey = firstKey;
      }
      // Delete map data
      delKey && mapData.delete(delKey);
      // Insert new data
      mapData.set(k, v);
  }
  const lruData = () => {
      return mapData.entries();
  }
  return {
      getData,
      setData,
      lruData
  }
}

const lruData = LRUUtil(3);
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

