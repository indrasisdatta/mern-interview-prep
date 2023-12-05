/** 
 * 500001500002500003 - len = 18 
 * chunks = 3 500001, 500002, 500003 
          = 6 500, 001, 500, 002, 500, 003
          = 9 50, 00, 01, 50, 00, 02, 50, 002, 03
 */   
const chunks = (str, size) => {
	let chunkArr = [];
  let len = str.length;
  if (len % size === 0) {
    // length of each chunk  
    // total len of string / len of each chunk 
    let chunkLen = len / size;
    // Run loop as per chunk count
  	for (let i = 0; i < size; i++) {     
    	let start = i * chunkLen, end = start + chunkLen;
      console.log('chunkArr loop',i, chunkArr, start, end)
      chunkArr.push(Number(str.substring(start, end)));
    }
  }
  console.log('chunks: ', size, chunkArr);
  return chunkArr;
}
// chunks("500001500002500003", 3);

const isConsecutive = (nos) => {
	let consFlag = true;
  if (nos.length == 1) {
  	console.log("Consecutive false");
    return false;
  }
  for (let k in nos) {
  	//console.log('Compare:', nos[k-1], nos[k])
  	if (k > 0  && nos[k] - nos[k-1] !== 1) {
    	consFlag = false;
      console.log('consFlag',nos[k] - nos[k-1], consFlag)
      break;
    }
  }
  console.log("Consecutive", consFlag);
  return consFlag;
}
// isConsecutive([23, 24, 25]);

/**
 * https://edabit.com/challenge/jN89tuARCFbtQm6vE
 * Ascending consecutive nos
 */
function ascending(str) {
	if (!str) {
  	return false;
  }
  let len = str.length;
  let i = 1;
  let cons = false;
  while (i <= len) {
  	console.log('Loop start', i, len)
  	// Need to break into equal chunks
    if (len % i !== 0) {
    	i++;
    	continue;
    }    
    cons = isConsecutive(chunks(str, i));
    console.log('Looping', i, len, cons)
    if (cons) break;
    i++;
  }
  return cons;
}


/* Test assertions */
var Test = {
  	assertEquals(str, boolCheck) {
    	console.log(`${str} Test Result:`, ascending(str) === boolCheck);
    }
}
 
/* Test.assertEquals(ascending("444445"), true)
Test.assertEquals(ascending("1234567"), true)
Test.assertEquals(ascending("123412351236"), true)
Test.assertEquals(ascending("57585960616263"), true)
Test.assertEquals(ascending("500001500002500003"), true)
Test.assertEquals(ascending("919920921"), true)
Test.assertEquals(ascending("2324256"), false) */
Test.assertEquals(ascending("1235"), false)
/* Test.assertEquals(ascending("121316"), false)
Test.assertEquals(ascending("12131213"), false)
Test.assertEquals(ascending("54321"), false)
Test.assertEquals(ascending("56555453"), false)
Test.assertEquals(ascending("90090190290"), false)
Test.assertEquals(ascending("35236237238"), false) */
