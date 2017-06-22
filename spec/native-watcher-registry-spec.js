/** @babel */

import {it, beforeEach} from './async-spec-helpers'

import path from 'path'
import {Emitter} from 'event-kit'

import NativeWatcherRegistry from '../src/native-watcher-registry'

class MockWatcher {
  constructor (normalizedPath) {
    this.normalizedPath = normalizedPath
    this.native = null
  }

  getNormalizedPathPromise () {
    return Promise.resolve(this.normalizedPath)
  }

  attachToNative (native) {
    this.native = native
    this.native.attached.push(this)
  }
}

class MockNative {
  constructor (name) {
    this.name = name
    this.attached = []
    this.disposed = false
    this.stopped = false

    this.emitter = new Emitter()
  }

  reattachTo (newNative) {
    for (const watcher of this.attached) {
      watcher.attachToNative(newNative)
    }

    this.attached = []
  }

  onDidStop (callback) {
    return this.emitter.on('did-stop', callback)
  }

  dispose () {
    this.disposed = true
  }

  stop () {
    this.stopped = true
    this.emitter.emit('did-stop')
  }
}

describe('NativeWatcherRegistry', function () {
  let createNative, registry

  beforeEach(function () {
    registry = new NativeWatcherRegistry(normalizedPath => createNative(normalizedPath))
  })

  it('attaches a Watcher to a newly created NativeWatcher for a new directory', async function () {
    const watcher = new MockWatcher(path.join('some', 'path'))
    const NATIVE = new MockNative('created')
    createNative = () => NATIVE

    await registry.attach(watcher)

    expect(watcher.native).toBe(NATIVE)
  })

  it('reuses an existing NativeWatcher on the same directory', async function () {
    const EXISTING = new MockNative('existing')
    const existingPath = path.join('existing', 'path')
    let firstTime = true
    createNative = () => {
      if (firstTime) {
        firstTime = false
        return EXISTING
      }

      return new MockNative('nope')
    }
    await registry.attach(new MockWatcher(existingPath))

    const watcher = new MockWatcher(existingPath)
    await registry.attach(watcher)

    expect(watcher.native).toBe(EXISTING)
  })

  it('attaches to an existing NativeWatcher on a parent directory', async function () {
    const EXISTING = new MockNative('existing')
    const parentDir = path.join('existing', 'path')
    const subDir = path.join(parentDir, 'sub', 'directory')
    let firstTime = true
    createNative = () => {
      if (firstTime) {
        firstTime = false
        return EXISTING
      }

      return new MockNative('nope')
    }
    await registry.attach(new MockWatcher(parentDir))

    const watcher = new MockWatcher(subDir)
    await registry.attach(watcher)

    expect(watcher.native).toBe(EXISTING)
  })

  it('adopts Watchers from NativeWatchers on child directories', async function () {
    const parentDir = path.join('existing', 'path')
    const childDir0 = path.join(parentDir, 'child', 'directory', 'zero')
    const childDir1 = path.join(parentDir, 'child', 'directory', 'one')
    const otherDir = path.join('another', 'path')

    const CHILD0 = new MockNative('existing0')
    const CHILD1 = new MockNative('existing1')
    const OTHER = new MockNative('existing2')
    const PARENT = new MockNative('parent')

    createNative = dir => {
      if (dir === childDir0) {
        return CHILD0
      } else if (dir === childDir1) {
        return CHILD1
      } else if (dir === otherDir) {
        return OTHER
      } else if (dir === parentDir) {
        return PARENT
      } else {
        throw new Error(`Unexpected path: ${dir}`)
      }
    }

    const watcher0 = new MockWatcher(childDir0)
    await registry.attach(watcher0)

    const watcher1 = new MockWatcher(childDir1)
    await registry.attach(watcher1)

    const watcher2 = new MockWatcher(otherDir)
    await registry.attach(watcher2)

    expect(watcher0.native).toBe(CHILD0)
    expect(watcher1.native).toBe(CHILD1)
    expect(watcher2.native).toBe(OTHER)

    // Consolidate all three watchers beneath the same native watcher on the parent directory
    const watcher = new MockWatcher(parentDir)
    await registry.attach(watcher)

    expect(watcher.native).toBe(PARENT)

    expect(watcher0.native).toBe(PARENT)
    expect(CHILD0.stopped).toBe(true)
    expect(CHILD0.disposed).toBe(true)

    expect(watcher1.native).toBe(PARENT)
    expect(CHILD1.stopped).toBe(true)
    expect(CHILD1.disposed).toBe(true)

    expect(watcher2.native).toBe(OTHER)
    expect(OTHER.stopped).toBe(false)
    expect(OTHER.disposed).toBe(false)
  })

  describe('removing NativeWatchers', function () {
    it('happens when they stop', async function () {
      const STOPPED = new MockNative('stopped')
      const RUNNING = new MockNative('running')

      const stoppedPath = ['watcher', 'that', 'will', 'be', 'stopped']
      const runningPath = ['watcher', 'that', 'will', 'continue', 'to', 'exist']

      createNative = dir => {
        if (dir === path.join(...stoppedPath)) {
          return STOPPED
        } else if (dir === path.join(...runningPath)) {
          return RUNNING
        } else {
          throw new Error(`Unexpected path: ${dir}`)
        }
      }

      const stoppedWatcher = new MockWatcher(path.join(...stoppedPath))
      await registry.attach(stoppedWatcher)

      const runningWatcher = new MockWatcher(path.join(...runningPath))
      await registry.attach(runningWatcher)

      STOPPED.stop()

      const runningNode = registry.tree.lookup(runningPath).when({
        parent: node => node,
        missing: () => false,
        children: () => false
      })
      expect(runningNode).toBeTruthy()
      expect(runningNode.getNativeWatcher()).toBe(RUNNING)

      const stoppedNode = registry.tree.lookup(stoppedPath).when({
        parent: () => false,
        missing: () => true,
        children: () => false
      })
      expect(stoppedNode).toBe(true)
    })

    it("keeps a parent watcher that's still running")

    it('reassigns new child watchers when a parent watcher is stopped')
  })
})