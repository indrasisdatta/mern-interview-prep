const merge = function(intervals) {
  if (!Array.isArray(intervals)) {
    console.error('Invalid input');
    return [];
  }
  if (intervals.length === 1) {
    return intervals;
  }
  intervals = intervals.sort((a, b) => Number(a[0]) - Number(b[0]));
  console.log('Sorted intervals: ', intervals);

  let result = [intervals[0]];
  let pointer = 0;
  for (let interval of intervals) {
    if (result[pointer][1] >= interval[0]) {
      result[pointer][1] = Math.max(interval[1], result[pointer][1]);
    } else {
      result[++pointer] = [...interval];
    }
  }
  return result;
};