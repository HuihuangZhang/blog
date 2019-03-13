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

class Node extends AbstractNode {
    constructor(parent, thing) {
        super(parent)
        this.children = {}
        Object.keys(thing).forEach(key => {
            this.children[key] = AbstractNode.from(thing[key], this)
        })
    }

    print() {
        return (
            '\n' +
            Object.keys(this.children)
                .map(key => `${''.padStart(this.getDepth() * 2)}${key}: ${this.children[key].print()}`)
                .join('\n')
        )
    }
}

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
    AbstractNode,
    Leaf,
    Node
};
