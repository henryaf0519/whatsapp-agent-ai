/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private dynamoService: DynamoService, // Inyecta el DynamoService
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    console.log('email: ', email);
    console.log('pass: ', pass);
    const user = await this.dynamoService.findUserByEmail(email);
    console.log('user: ', user);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (pass === user.pass) {
      console.log('here');
    }
    const isMatch = await bcrypt.compare(pass, user.password);
    console.log('ismat: ', isMatch);

    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { password, ...result } = user;
    return result;
  }

  async login(user: any): Promise<{ access_token: string }> {
    const payload = { sub: user.email, username: user.email };
    console.log('AuthService - login: Payload for JWT:', payload);
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async createUser(email: string, password: string): Promise<any> {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.dynamoService.createUserLogin(
      email,
      hashedPassword,
    );
    return user;
  }
}
