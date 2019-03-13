const { AbstractNode } = require('./AbstractNode');

class Leaf extends AbstractNode {
    constructor(parent, value) {
        super(parent)
        this.value = value
    }

    print() {
        return this.value
    }
}

module.exports = {
    Leaf
};