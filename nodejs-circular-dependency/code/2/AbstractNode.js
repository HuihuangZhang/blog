const { Leaf } = require('./Leaf');
const { Node } = require('./Node');

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
        if (thing && typeof thing === 'object') return new Node(parent, thing)
        else return new Leaf(parent, thing)
    }
}

module.exports = {
    AbstractNode
};
