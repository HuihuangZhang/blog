
const all = require('./AbstractNode');

all.AbstractNode.from({
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

