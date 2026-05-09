import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';

import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { CloseMarketSellOrderDto } from './dto/close-market-sell-order.dto';
import { PlaceMarketBuyOrderDto } from './dto/place-market-buy-order.dto';
import { OrdersService } from './orders.service';

interface JwtPayload {
  sub: string;
  email: string;
}

type AuthenticatedSocket = Socket & {
  user?: {
    userId: string;
    email: string;
  };
};

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly ordersService: OrdersService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });

      client.user = {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('market_buy_order')
  async handleMarketBuyOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ) {
    if (!client.user) {
      client.emit('order_rejected', {
        message: 'Unauthorized',
      });
      return;
    }

    const dto = plainToInstance(PlaceMarketBuyOrderDto, payload);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      client.emit('order_rejected', {
        message: 'Invalid buy order payload',
      });
      return;
    }

    try {
      const result = await this.ordersService.placeMarketBuyOrder(
        client.user.userId,
        dto,
      );

      client.emit('order_filled', result);
    } catch (error) {
      client.emit('order_rejected', {
        message: error instanceof Error ? error.message : 'Order rejected',
      });
    }
  }

  @SubscribeMessage('market_sell_order')
  async handleMarketSellOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ) {
    if (!client.user) {
      client.emit('order_rejected', {
        message: 'Unauthorized',
      });
      return;
    }

    const dto = plainToInstance(CloseMarketSellOrderDto, payload);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      client.emit('order_rejected', {
        message: 'Invalid sell order payload',
      });
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const result = await this.ordersService.closeMarketSellOrder(
        client.user.userId,
        dto,
      );

      client.emit('order_closed', result);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      client.emit('portfolio_value_updated', result.portfolioSummary);
    } catch (error) {
      client.emit('order_rejected', {
        message: error instanceof Error ? error.message : 'Order rejected',
      });
    }
  }

  @SubscribeMessage('portfolio_summary')
  async handlePortfolioSummary(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.user) {
      client.emit('portfolio_summary_error', {
        message: 'Unauthorized',
      });
      return;
    }

    try {
      const summary = await this.ordersService.getPortfolioSummary(
        client.user.userId,
      );

      client.emit('portfolio_summary', summary);
    } catch (error) {
      client.emit('portfolio_summary_error', {
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load portfolio summary',
      });
    }
  }

  private extractToken(client: Socket): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string') {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const authorization = client.handshake.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [type, token] = authorization.split(' ');

    return type === 'Bearer' ? token : undefined;
  }
}
