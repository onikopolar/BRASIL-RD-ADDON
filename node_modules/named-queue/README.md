# named-queue
like async.queue, but tasks are named and de-duplicated

## Init


### ``var namedQueue = require('named-queue')``
### ``var queue = new namedQueue(processor, concurrency)``

#### `processor` - `function(task, cb)`

#### `concurrency` - `Number` for maximum concurrent tasks; can be `Infinity`

## Methods

**WARNING** All tasks must have an **`.id`** property used to identify and avoid doing the same task more than once at a time

### ``queue.push(task, cb)``

### ``queue.unshift(task, cb)``

### ``queue.length()``
