const chunks = (str, size) => {
	let chunkArr = [];
  let len = str.length;
  if (len % size === 0) {
  	for (let i = 0; i < len; i += size) {
    	let start = i, end = i + size;
      chunkArr.push(Number(str.substring(start, end)));
    }
  }
  console.log(chunkArr);
  return chunkArr;
}
/* chunks("123124125", 3); */

const isConsecutive = (nos) => {
	let consFlag = true;
  for (let k in nos) {
  	//console.log('Compare:', nos[k-1], nos[k])
  	if (k > 0  && nos[k] - nos[k-1] !== 1) {
    	consFlag = false;
      console.log('consFlag',nos[k] - nos[k-1], consFlag)
      break;
    }
  }
  //console.log("Consecutive", consFlag);
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
  while (i < len) {
  	// Need to break into equal chunks
    if (len % i !== 0) {
    	continue;
    }
    cons = isConsecutive(chunks(str, i));
    if (cons) break;
    i++;
  }
  return cons;
}


/* Test assertions */
var Test = {
  	assertEquals(str, boolCheck) {
    	console.log(ascending(str) === boolCheck);
    }
}
 
/* Test.assertEquals(ascending("444445"), true) */
/* Test.assertEquals(ascending("1234567"), true) */
/* Test.assertEquals(ascending("123412351236"), true) */
/* Test.assertEquals(ascending("57585960616263"), true) */
Test.assertEquals(ascending("500001500002500003"), true)
/* Test.assertEquals(ascending("919920921"), true) */
/* 
Test.assertEquals(ascending("2324256"), false)
Test.assertEquals(ascending("1235"), false)
Test.assertEquals(ascending("121316"), false)
Test.assertEquals(ascending("12131213"), false)
Test.assertEquals(ascending("54321"), false)
Test.assertEquals(ascending("56555453"), false)
Test.assertEquals(ascending("90090190290"), false)
Test.assertEquals(ascending("35236237238"), false)  */

