import { Logger, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { Bus } from './bus';

/** Socket.IO 실시간 갱신. 사용자는 자기 기관 방(org:<id>)에만 들어간다. 중앙 관리자는 org:* */
@WebSocketGateway({ path: '/socket.io', cors: false })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Server;
  constructor(private readonly auth: AuthService, private readonly bus: Bus) {}

  onModuleInit() {
    this.bus.on(({ orgId, event, payload }) => {
      if (!this.server) return;
      this.server.to(`org:${orgId}`).to('org:*').emit(event, payload);
    });
  }

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token as string;
      const u = await this.auth.verifyToken(token, 'access', socket.handshake.address);
      if (u.requires_mfa && !u.mfa_enabled) throw new Error('mfa');
      if (!u.permissions.includes('device.read')) throw new Error('perm');
      socket.join(u.is_platform && u.role === 'central_admin' ? 'org:*' : `org:${u.org_id}`);
      (socket.data as any).user = u.id;
    } catch {
      socket.emit('auth_error', { message: '인증 실패' });
      socket.disconnect(true);
    }
  }
}
