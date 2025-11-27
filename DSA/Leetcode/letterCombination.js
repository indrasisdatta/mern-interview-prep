/**
 * @param {string} digits
 * @return {string[]}

 *  a      b       c 
 * d e f   d e f  d e f
 */
var letterCombinations = function(digits) {
    if (!digits || digits.includes('0') || digits.includes('1')) {
        console.error('Invalid range');
        return [];
    }
    const digitsMapping = {
        "2": "abc",
        "3": "def",
        "4": "ghi",
        "5": "jkl",
        "6": "mno",
        "7": "pqrs",
        "8": "tuv",
        "9": "wxyz"
    };

    let result = [], temp = [];

    backtrack(0, result, temp);

    function backtrack(currentIndex) {
        // digits[currentIndex] -> 2  digitsMapping[digits[currentIndex]] = abc 
        
        if (currentIndex === digits.length) {
            result.push([...temp].join(""));
            // console.log('Push result: ', result);
            return;
        }
        let letters = digitsMapping[digits[currentIndex]];

        for (let ch of letters) {
            temp.push(ch);
            backtrack(currentIndex + 1);
            temp.pop();
        }        
    }  

    return result;
};

