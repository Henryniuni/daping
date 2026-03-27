/**
 * AudioWorklet 处理器：将麦克风/标签页音频的 Float32 数据发送到主线程
 * 替代已废弃的 ScriptProcessorNode
 */
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
