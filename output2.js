for (var i = 0; i < 3; i++) {
	/* Workaround 1 */
	/* function print(i) {
	    setTimeout(() => {
	      console.log(i)
	    }, 100)
	  }
	  print(i); */
  /* Workaround 2 */
	(function(i) {
  	setTimeout(() => {
      console.log(i)
    }, 100)
  })(i)
  
}
