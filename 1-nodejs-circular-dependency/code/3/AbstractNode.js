const all = require('./internal');

console.log(`all`, all);
class AbstractNode {
    constructor(parent) {
        this.parent = parent
    }

    getDepth() {
        if (this.parent) return this.parent.getDepth() + 1
        return 0
    }

    print() {
        throw 'abstract; not implemented'
    }

    static from(thing, parent) {
        if (thing && typeof thing === 'object') return new all.Node(parent, thing)
        else return new all.Leaf(parent, thing)
    }
}

module.exports = exports = {
    AbstractNode
};
