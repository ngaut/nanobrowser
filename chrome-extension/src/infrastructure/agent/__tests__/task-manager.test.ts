import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManager, TaskStatus, type TaskInfo } from '../task-manager';

describe('TaskManager', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
  });

  describe('Task Creation', () => {
    it('should create a task with correct initial properties', () => {
      const task = taskManager.createTask('Test task');

      expect(task).toMatchObject({
        description: 'Test task',
        status: TaskStatus.PENDING,
        createdAt: expect.any(Date),
      });
      expect(task.id).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it('should create a task with parent task ID', () => {
      const task = taskManager.createTask('Child task', 'parent-123');

      expect(task.parentTaskId).toBe('parent-123');
    });

    it('should assign unique IDs to different tasks', () => {
      const task1 = taskManager.createTask('Task 1');
      const task2 = taskManager.createTask('Task 2');

      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe('Task Lifecycle Methods (Fixed Method Names)', () => {
    let testTask: TaskInfo;

    beforeEach(() => {
      testTask = taskManager.createTask('Test task');
    });

    it('should start task using start() method', async () => {
      await taskManager.start(testTask.id);

      const currentTask = taskManager.getCurrentTask();
      expect(currentTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(currentTask?.startedAt).toBeInstanceOf(Date);
    });

    it('should complete task using complete() method', async () => {
      await taskManager.start(testTask.id);
      await taskManager.complete(testTask.id);

      const task = taskManager.getAllTasks().find(t => t.id === testTask.id);
      expect(task?.status).toBe(TaskStatus.COMPLETED);
      expect(task?.completedAt).toBeInstanceOf(Date);
    });

    it('should fail task using fail() method with string error', async () => {
      await taskManager.start(testTask.id);
      await taskManager.fail(testTask.id, 'Test error message');

      const task = taskManager.getAllTasks().find(t => t.id === testTask.id);
      expect(task?.status).toBe(TaskStatus.FAILED);
      expect(task?.failureReason).toBe('Test error message');
      expect(task?.completedAt).toBeInstanceOf(Date);
    });

    it('should cancel task using cancel() method', async () => {
      await taskManager.start(testTask.id);
      await taskManager.cancel(testTask.id);

      const task = taskManager.getAllTasks().find(t => t.id === testTask.id);
      expect(task?.status).toBe(TaskStatus.CANCELLED);
      expect(task?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('Follow-up Tasks (Fixed Return Type)', () => {
    let parentTask: TaskInfo;

    beforeEach(async () => {
      parentTask = taskManager.createTask('Parent task');
      await taskManager.start(parentTask.id);
    });

    it('should add follow-up task using addFollowUp() method', async () => {
      const followUpTask = await taskManager.addFollowUp('Follow-up task');

      expect(followUpTask).toMatchObject({
        description: 'Follow-up task',
        status: TaskStatus.PENDING,
        parentTaskId: parentTask.id,
      });

      // Verify it returns TaskInfo, not just string ID
      expect(followUpTask).toHaveProperty('id');
      expect(followUpTask).toHaveProperty('createdAt');
      expect(followUpTask).toHaveProperty('status');
    });

    it('should add follow-up task with metadata', async () => {
      const metadata = { priority: 'high', category: 'user-request' };
      const followUpTask = await taskManager.addFollowUp('Urgent task', metadata);

      expect(followUpTask.metadata).toEqual(metadata);
    });

    it('should throw error when no current task for follow-up', async () => {
      // Don't start any task
      const emptyTaskManager = new TaskManager();

      await expect(emptyTaskManager.addFollowUp('Invalid follow-up')).rejects.toThrow(
        'No current task to add follow-up to',
      );
    });
  });

  describe('Task Status Management', () => {
    it('should track current task correctly', async () => {
      const task = taskManager.createTask('Current task');
      await taskManager.start(task.id);

      const currentTask = taskManager.getCurrentTask();
      expect(currentTask?.id).toBe(task.id);
      expect(currentTask?.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should clear current task when completed', async () => {
      const task = taskManager.createTask('Task to complete');
      await taskManager.start(task.id);
      await taskManager.complete(task.id);

      const currentTask = taskManager.getCurrentTask();
      expect(currentTask).toBeNull();
    });

    it('should clear current task when failed', async () => {
      const task = taskManager.createTask('Task to fail');
      await taskManager.start(task.id);
      await taskManager.fail(task.id, 'Test failure');

      const currentTask = taskManager.getCurrentTask();
      expect(currentTask).toBeNull();
    });
  });

  describe('Error Handling (Structured Errors)', () => {
    it('should throw ExecutionError for non-existent task', async () => {
      await expect(taskManager.start('non-existent-task')).rejects.toThrow('Task not found: non-existent-task');
    });

    it('should throw ConfigurationError for invalid task status', async () => {
      const task = taskManager.createTask('Test task');
      await taskManager.start(task.id);

      // Try to start already started task
      await expect(taskManager.start(task.id)).rejects.toThrow('is not in pending status');
    });
  });

  describe('Task Statistics', () => {
    it('should provide accurate task statistics', async () => {
      // Create and manage multiple tasks
      const task1 = taskManager.createTask('Task 1');
      const task2 = taskManager.createTask('Task 2');
      const task3 = taskManager.createTask('Task 3');

      await taskManager.start(task1.id);
      await taskManager.complete(task1.id);

      await taskManager.start(task2.id);
      await taskManager.fail(task2.id, 'Test error');

      await taskManager.start(task3.id);
      // Leave task3 in progress

      const stats = taskManager.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.byStatus[TaskStatus.COMPLETED]).toBe(1);
      expect(stats.byStatus[TaskStatus.FAILED]).toBe(1);
      expect(stats.byStatus[TaskStatus.IN_PROGRESS]).toBe(1);
      expect(stats.completionRate).toBeCloseTo(1 / 3);
    });
  });

  describe('Task Queue Management', () => {
    it('should manage task queue correctly', () => {
      const task1 = taskManager.createTask('Task 1');
      const task2 = taskManager.createTask('Task 2');

      const nextTask = taskManager.getNextTask();
      expect(nextTask?.id).toBe(task1.id);

      const secondTask = taskManager.getNextTask();
      expect(secondTask?.id).toBe(task2.id);

      const noMoreTasks = taskManager.getNextTask();
      expect(noMoreTasks).toBeNull();
    });
  });

  describe('Integration with AgentService', () => {
    it('should work correctly with the method calls from AgentService', async () => {
      // Simulate the exact method calls that AgentService makes
      const task = taskManager.createTask('Integration test task');

      // Test the sequence of calls that caused the original "method not found" errors
      await taskManager.start(task.id); // Was: startTask()

      // Simulate successful completion
      await taskManager.complete(task.id); // Was: completeTask()

      const completedTask = taskManager.getAllTasks().find(t => t.id === task.id);
      expect(completedTask?.status).toBe(TaskStatus.COMPLETED);
    });

    it('should handle error scenario correctly', async () => {
      const task = taskManager.createTask('Error test task');

      await taskManager.start(task.id);

      // Simulate error handling - fail() now takes string, not Error object
      await taskManager.fail(task.id, 'Simulated error message'); // Was: failTask()

      const failedTask = taskManager.getAllTasks().find(t => t.id === task.id);
      expect(failedTask?.status).toBe(TaskStatus.FAILED);
      expect(failedTask?.failureReason).toBe('Simulated error message');
    });

    it('should handle follow-up task creation correctly', async () => {
      const parentTask = taskManager.createTask('Parent task');
      await taskManager.start(parentTask.id);

      // Test that addFollowUp returns TaskInfo, not just string
      const followUpTask = await taskManager.addFollowUp('Follow-up task'); // Was: addFollowUpTask()

      expect(followUpTask).toHaveProperty('id');
      expect(followUpTask).toHaveProperty('description');
      expect(followUpTask).toHaveProperty('status');
      expect(followUpTask.parentTaskId).toBe(parentTask.id);
    });
  });
});
