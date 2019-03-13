const all = require('./internal');
const AbstractNode = all.AbstractNode;
console.log(AbstractNode.from({
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
}).print());