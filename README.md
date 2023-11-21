# Javascript interview preparation

Javascript, ecmascript, typescript

1) currying
2) hoisting, function hoisting and variable hoisting
3) const vs let vs var
4) closure, iife, singleton
5) promise, observable, promise vs observable
6) asynchronous functions and synchronous functions
7) how to deal with asynchronous logics in javascript? callbacks, callback hell, splitting logics in function, promises, better way to handle promises using promise libraries async, bluebird, axios, modern javascript async await - a way to make asynchronous logic work synchronous, how to convert a promise to async await 
8) event binding, propagation: bubbling and capturing, stop propagation, prevent default 
9) event loop and how javascript works 
10) multiple javascript runtime for handling long running processes, webworkers
11) cookies vs sessionstorage vs localstorage
12) how to make an object read only
13) shallow copy vs deep copy
14) var a ={'name' :'a' , 'age' :31} ;
var b= a;
console. log(a===b) // true
console. log(a==b) // true
var c= {... a} ;
console. log(a===c) //false
console. log(a==c) //false

15) the same question above for an associative array
a=[35, 56,35,97];
distinct the above array. 

16) map, filter, reduce
17) iterator, generator
18) spread operators
19) new functionalities in javascript. map vs set. 
20) javascript is sexy first 7 chapters especiially object, this and functions. 
Recursion,fibonacci, palindrome, factorial, permutation, combination using javascript. 

21) from an array of object consisting of emp data getting the max salary
   const arr = [
          { name:'a', age:35, salary:100000, dept:['Sales','Finance'] },
          { name:'b', age:27, salary:120000, dept:['Software'] },
          { name:'c', age:32, salary:200000, dept:['Operations','Finance'] },
          { name:'d', age:23, salary:115000, dept:['HR','finance'] },
    ]
i. find the highest salary
ii. find all the departments with salary >= 12000

const depts = arr.filter(emp => emp.salary >= 120000)
					.map(emp => emp.dept)
                    .reduce((initial, acc) => [...initial, ...acc])

iv. creating a result consisting of no. of employees for each of the department.
Sample to practice with:

    

23) splice vs slice 
24) how to break a map / filter / reduce iteration
25) sort, push, delete 
26) Infinite currying
27) foreach, for… of, for…. in
28) call vs bind vs apply
29) lexical scope in javascript
what values falsify in javascript? 
30) null vs undefined vs '' 
31) ways to iterate an iterator 
32) parallell asynchronous call vs serial asynchronous calls (promise chaining) . promise. all() 
31) rest api methods and when to use which
32) authentication, jwt, oauth
33) [] ==[]    [] ===[] 
{} =={}.  {} ==={}

34) DOM, shadow dom, incremental dom, virtual dom
35) Array destructuring
36) Debounce in javascript. How to achieve better performance while typing and searching using api
37) 
    function abc(a,b,c){
    //// some definition here
    }
    console.log(abc.length)  /// output will be 3 as 3 inputs
38) Multiple src file include in script tag without promise and async
39) Promise.all v/s async
40) Error handling 
41) Data structure examples
