/**
 * @param {number} numCourses
 * @param {number[][]} prerequisites
 * @return {boolean}
 * LOGIC:
 *  Freq map for prerequisites Map(node, prereq)
 *  Queue for leaf nodes i.e canBeTaken (keep pushing when prereq freq = 0)
 *  DFS for each queue element - decrement freq of neighbors
 */
var canFinish = function(numCourses, prerequisites) {
    let prereqMap = new Map();
    let coursesCanBeTaken = [];
    let indegree = Array.from({ length: numCourses }, (_, k) => 0);
    let completed = 0;
    
    /* Frequency map of prerequisite courses */
    for (let [node, prereq] of prerequisites) {
        let prereqVal = prereqMap.get(prereq) || [];
        prereqVal.push(prereqVal);
        prereqMap.set(prereq, prereqVal);
        indegree[node]++;
    }
    /* Courses can be taken - which don't have any prerequisites */
    for (let i = 0; i < numCourses; i++) {
        if (indegree[i] === 0) {
            coursesCanBeTaken.push(i);
        }
    }
    console.log('prereqMap -> ', prereqMap)
    while (coursesCanBeTaken.length > 0) {
        let course = coursesCanBeTaken.shift();
        completed++;

        if (prereqMap.has(course)) {
            for (let mainCourse of prereqMap.get(course)) {
                indegree[mainCourse]--;
                if (indegree[mainCourse] === 0) {
                    coursesCanBeTaken.push(mainCourse);
                }
            }
        }        
    }
    return completed === numCourses;
}