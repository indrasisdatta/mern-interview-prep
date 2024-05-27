/**
 * Create a Utility class for a LRU
 * It should store only the least recently used values (recently stored and accessed)
 * If max size is reached, old values should be removed
 */
const LRUUtil = (MAX_CACHE_SIZE) => {
  
}

const lruData = LRUUtil(2);
lruData.setData('1', '1 value');
lruData.setData('2', '3 value');
lruData.setData('3', '3 value');
lruData.setData('2', '2 updated value');

// Expected - 2 => '3 value', 3 => '2 updated value'

lruData.getData(2);
lruData.getData(1);

// Expected - 1 => '1 value', 2 => '2 value'
