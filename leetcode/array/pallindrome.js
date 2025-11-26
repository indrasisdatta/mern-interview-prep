/**
 * @param {number} x
 * @return {boolean}
 */
var isPalindrome = function(x) {
    if (typeof x !== "number" || x < 0) {
        console.error("Invalid input");
        return false;
    }
    let str = x.toString();
    // 1331 i = 0, j = 3
    // 121 
    let j = str.length - 1;
    for (let i = 0; i < str.length/2; i++) {
        if (i >= j) break;
        if (str[i] !== str[j]) {
            return false;
        } 
        j--;
    }
    return true;
};
