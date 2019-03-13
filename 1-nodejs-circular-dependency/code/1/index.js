
const all = require('./All');

let result = all.AbstractNode.from({
    today: {
        needCoffee: true,
        writeBlog: true
    },
    tomorrow: {
        holiday: 'hopefully!',
        zenMode: {
            forever: true
        }
    }
}).print();

console.log(result);
