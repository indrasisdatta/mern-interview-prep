var minWindow = function(s, t) {
    // A: 1, B: 1, C: 1
    let sourceMap = new Map(), 
        windowMap = new Map();
    for (let ch of t) {
        sourceMap.set(ch, (sourceMap.get(ch) || 0) + 1);        
    }
    let start = 0, have = 0, need = sourceMap.size;
    let minLen = Infinity;
    let output = "";
    for (let end = 0; end < s.length; end++) {
        windowMap.set(s[end], (windowMap.get(s[end]) || 0) +1); 
        if (sourceMap.has(s[end]) && sourceMap.get(s[end]) === windowMap.get(s[end])) {
            have++;
        }
        while (need === have) {
            if (end-start+1 < minLen) {
                minLen = end-start+1;
                output = s.slice(start, end+1);
            }
            windowMap.set(s[start], (windowMap.get(s[start]) || 0) -1);
            if (
                sourceMap.has(s[start]) && 
                windowMap.get(s[start]) < sourceMap.get(s[start])
            ) {
                have--;
            }
            start++;
        }        
    }
    return output;
}
